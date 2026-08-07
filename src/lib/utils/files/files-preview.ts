export type PreviewKind = "image" | "svg" | "pdf" | "binary";

const IMAGE_EXT = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"ico",
	"avif",
	"apng",
]);

export function previewKindFromPath(filePath: string): PreviewKind {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	if (IMAGE_EXT.has(ext)) return "image";
	if (ext === "svg") return "svg";
	if (ext === "pdf") return "pdf";
	return "binary";
}

const MIME_BY_EXT: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif",
	apng: "image/apng",
	svg: "image/svg+xml",
	pdf: "application/pdf",
};

export function mimeFromPath(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function svgDataUrl(source: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

export function formatByteSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function hexToBytes(hex: string): Uint8Array {
	const clean = hex.length % 2 === 0 ? hex : hex.slice(0, -1);
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

const HEX_COLUMNS = 16;

export function formatHexDump(bytes: Uint8Array): string {
	const lines: string[] = [];
	for (let offset = 0; offset < bytes.length; offset += HEX_COLUMNS) {
		const row = bytes.subarray(offset, offset + HEX_COLUMNS);
		const hex: string[] = [];
		let ascii = "";
		for (let i = 0; i < HEX_COLUMNS; i++) {
			const byte = row[i];
			hex.push(byte === undefined ? "  " : byte.toString(16).padStart(2, "0"));
			if (byte === undefined) continue;
			ascii += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".";
		}
		const left = hex.slice(0, 8).join(" ");
		const right = hex.slice(8).join(" ");
		lines.push(
			`${offset.toString(16).padStart(8, "0")}  ${left}  ${right}  |${ascii}|`,
		);
	}
	return lines.join("\n");
}
