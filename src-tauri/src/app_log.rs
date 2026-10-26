// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The app's own log, `logs/cairn.log` in the data directory, rotated by size.
//!
//! It records each start, each clean exit, panics and the signals that end the
//! process, with the pid that sent them. A window that vanished then leaves its
//! cause behind: a signal line names the killer, a panic line the bug, and a
//! start with neither an exit nor a signal before it points at SIGKILL or the
//! kernel OOM killer, which nothing in-process can observe.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, TryLockError};

const FILE_NAME: &str = "cairn.log";
const MAX_BYTES: u64 = 1024 * 1024;
/// The live file plus its rotated predecessors.
const KEEP: usize = 3;

struct Log {
    dir: PathBuf,
    file: File,
    size: u64,
}

static LOG: Mutex<Option<Log>> = Mutex::new(None);

/// Opens the log and installs the panic hook and the signal handlers. A log
/// that cannot be opened is skipped silently: it must never stop the app.
pub fn init() {
    let Ok(dir) = crate::storage::logs_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let Some(log) = open(&dir) else { return };
    #[cfg(unix)]
    signals::set_file(&log.file);
    *lock() = Some(log);
    install_panic_hook();
    #[cfg(unix)]
    signals::install();
    info(&format!(
        "start {} pid {} channel {}",
        env!("CARGO_PKG_VERSION"),
        std::process::id(),
        crate::storage::channel().label().unwrap_or("release"),
    ));
}

pub fn info(message: &str) {
    append(&line("INFO", message), lock());
}

pub fn warn(message: &str) {
    append(&line("WARN", message), lock());
}

fn line(level: &str, message: &str) -> String {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f %z");
    format!("{now} {level} {message}\n")
}

fn lock() -> MutexGuard<'static, Option<Log>> {
    LOG.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn append(line: &str, mut slot: MutexGuard<'_, Option<Log>>) {
    let Some(log) = slot.as_mut() else { return };
    if log.size + line.len() as u64 > MAX_BYTES {
        let dir = log.dir.clone();
        #[cfg(unix)]
        signals::clear_file();
        // Windows refuses to rename a file that is still open.
        *slot = None;
        rotate(&dir);
        *slot = open(&dir);
        #[cfg(unix)]
        if let Some(log) = slot.as_ref() {
            signals::set_file(&log.file);
        }
    }
    let Some(log) = slot.as_mut() else { return };
    if log.file.write_all(line.as_bytes()).is_ok() {
        log.size += line.len() as u64;
    }
}

fn open(dir: &Path) -> Option<Log> {
    let path = dir.join(FILE_NAME);
    if fs::metadata(&path).is_ok_and(|m| m.len() >= MAX_BYTES) {
        rotate(dir);
    }
    let file = OpenOptions::new().create(true).append(true).open(&path).ok()?;
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    Some(Log { dir: dir.to_path_buf(), file, size })
}

fn rotated(dir: &Path, index: usize) -> PathBuf {
    dir.join(format!("{FILE_NAME}.{index}"))
}

fn rotate(dir: &Path) {
    for index in (1..KEEP - 1).rev() {
        let _ = fs::rename(rotated(dir, index), rotated(dir, index + 1));
    }
    let _ = fs::rename(dir.join(FILE_NAME), rotated(dir, 1));
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let backtrace = std::backtrace::Backtrace::force_capture();
        let message = format!("panic in thread '{}': {info}\n{backtrace}", thread.name().unwrap_or("unnamed"));
        // A panic raised while the log is held would deadlock on a blocking lock.
        match LOG.try_lock() {
            Ok(slot) => append(&line("ERROR", &message), slot),
            Err(TryLockError::Poisoned(poisoned)) => append(&line("ERROR", &message), poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => {}
        }
        previous(info);
    }));
}

/// Handlers for the catchable signals that end the process. They only append
/// one line and hand the signal back to whatever handled it before, so the
/// process dies exactly as it did without them.
#[cfg(unix)]
mod signals {
    use std::fs::File;
    use std::os::fd::AsRawFd;
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicI32, Ordering};

    const WATCHED: [(libc::c_int, &[u8]); 5] = [
        (libc::SIGTERM, b"SIGTERM"),
        (libc::SIGINT, b"SIGINT"),
        (libc::SIGHUP, b"SIGHUP"),
        (libc::SIGQUIT, b"SIGQUIT"),
        (libc::SIGABRT, b"SIGABRT"),
    ];

    static FD: AtomicI32 = AtomicI32::new(-1);
    static PREVIOUS: OnceLock<[libc::sigaction; WATCHED.len()]> = OnceLock::new();

    pub fn set_file(file: &File) {
        FD.store(file.as_raw_fd(), Ordering::SeqCst);
    }

    pub fn clear_file() {
        FD.store(-1, Ordering::SeqCst);
    }

    pub fn install() {
        // SAFETY: a zeroed sigaction is a valid empty value for sigaction to fill.
        let mut previous: [libc::sigaction; WATCHED.len()] = unsafe { std::mem::zeroed() };
        for (slot, (signal, _)) in previous.iter_mut().zip(WATCHED) {
            // SAFETY: `handle` has the SA_SIGINFO signature and only makes
            // async-signal-safe calls.
            unsafe {
                let mut action: libc::sigaction = std::mem::zeroed();
                action.sa_sigaction = handle as *const () as usize;
                action.sa_flags = libc::SA_SIGINFO;
                libc::sigemptyset(&mut action.sa_mask);
                libc::sigaction(signal, &action, slot);
            }
        }
        let _ = PREVIOUS.set(previous);
    }

    extern "C" fn handle(signal: libc::c_int, info: *mut libc::siginfo_t, _: *mut libc::c_void) {
        let mut line = Line::default();
        line.push(b"signal ");
        let index = WATCHED.iter().position(|(s, _)| *s == signal);
        match index {
            Some(i) => line.push(WATCHED[i].1),
            None => line.push_number(signal as u64),
        }
        // SAFETY: the kernel hands an SA_SIGINFO handler a valid siginfo.
        let sender = if info.is_null() { 0 } else { unsafe { (*info).si_pid() } };
        if sender > 0 {
            line.push(b" from pid ");
            line.push_number(sender as u64);
            #[cfg(target_os = "linux")]
            push_command(&mut line, sender);
        }
        line.push(b" at unix time ");
        line.push_number(now());
        line.push(b"\n");
        let fd = FD.load(Ordering::SeqCst);
        // SAFETY: write, sigaction and raise are async-signal-safe.
        unsafe {
            if fd >= 0 {
                libc::write(fd, line.bytes.as_ptr().cast(), line.len);
            }
            if let (Some(i), Some(previous)) = (index, PREVIOUS.get()) {
                libc::sigaction(signal, &previous[i], std::ptr::null_mut());
            }
            // Blocked until this handler returns, then delivered to the previous one.
            libc::raise(signal);
        }
    }

    fn now() -> u64 {
        // SAFETY: clock_gettime is async-signal-safe and fills the timespec.
        unsafe {
            let mut time: libc::timespec = std::mem::zeroed();
            libc::clock_gettime(libc::CLOCK_REALTIME, &mut time);
            time.tv_sec as u64
        }
    }

    /// Appends ` (comm)` with the sender's name from `/proc/<pid>/comm`.
    #[cfg(target_os = "linux")]
    fn push_command(line: &mut Line, pid: libc::pid_t) {
        let mut path = Line::default();
        path.push(b"/proc/");
        path.push_number(pid as u64);
        path.push(b"/comm\0");
        let mut name = [0u8; 32];
        // SAFETY: open, read and close are async-signal-safe; `path` is NUL-terminated.
        let read = unsafe {
            let fd = libc::open(path.bytes.as_ptr().cast(), libc::O_RDONLY);
            if fd < 0 {
                return;
            }
            let read = libc::read(fd, name.as_mut_ptr().cast(), name.len());
            libc::close(fd);
            read
        };
        if read > 0 {
            let name = &name[..read as usize];
            line.push(b" (");
            line.push(name.strip_suffix(b"\n").unwrap_or(name));
            line.push(b")");
        }
    }

    /// A fixed buffer: a signal handler must not allocate.
    pub(super) struct Line {
        pub(super) bytes: [u8; 160],
        pub(super) len: usize,
    }

    impl Default for Line {
        fn default() -> Self {
            Self { bytes: [0; 160], len: 0 }
        }
    }

    impl Line {
        pub(super) fn push(&mut self, part: &[u8]) {
            let take = part.len().min(self.bytes.len() - self.len);
            self.bytes[self.len..self.len + take].copy_from_slice(&part[..take]);
            self.len += take;
        }

        pub(super) fn push_number(&mut self, mut value: u64) {
            let mut digits = [0u8; 20];
            let mut start = digits.len();
            loop {
                start -= 1;
                digits[start] = b'0' + (value % 10) as u8;
                value /= 10;
                if value == 0 {
                    break;
                }
            }
            self.push(&digits[start..]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cairn-app-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rotate_shifts_files_and_drops_the_oldest() {
        let dir = scratch("rotate");
        fs::write(dir.join(FILE_NAME), "live").unwrap();
        fs::write(rotated(&dir, 1), "one").unwrap();
        fs::write(rotated(&dir, 2), "two").unwrap();
        rotate(&dir);
        assert!(!dir.join(FILE_NAME).exists());
        assert_eq!(fs::read_to_string(rotated(&dir, 1)).unwrap(), "live");
        assert_eq!(fs::read_to_string(rotated(&dir, 2)).unwrap(), "one");
        assert!(!rotated(&dir, 3).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_rotates_a_full_file_and_appends_to_a_small_one() {
        let dir = scratch("open");
        fs::write(dir.join(FILE_NAME), "kept\n").unwrap();
        assert_eq!(open(&dir).unwrap().size, 5);
        assert!(!rotated(&dir, 1).exists());

        fs::write(dir.join(FILE_NAME), vec![b'x'; MAX_BYTES as usize]).unwrap();
        assert_eq!(open(&dir).unwrap().size, 0);
        assert_eq!(fs::metadata(rotated(&dir, 1)).unwrap().len(), MAX_BYTES);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_rotates_once_the_line_would_overflow() {
        let dir = scratch("append");
        fs::write(dir.join(FILE_NAME), vec![b'x'; MAX_BYTES as usize - 4]).unwrap();
        let slot = Mutex::new(open(&dir));
        append("overflow\n", slot.lock().unwrap());
        assert_eq!(fs::read_to_string(dir.join(FILE_NAME)).unwrap(), "overflow\n");
        assert_eq!(fs::metadata(rotated(&dir, 1)).unwrap().len(), MAX_BYTES - 4);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn signal_line_formats_numbers_and_truncates() {
        let mut line = signals::Line::default();
        line.push(b"pid ");
        line.push_number(0);
        line.push(b" ");
        line.push_number(1_793_027_125);
        assert_eq!(&line.bytes[..line.len], b"pid 0 1793027125");
        line.push(&[b'y'; 400]);
        assert_eq!(line.len, line.bytes.len());
    }
}
