const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i;

function gamma(channel: number): number {
	const v =
		channel <= 0.0031308
			? 12.92 * channel
			: 1.055 * channel ** (1 / 2.4) - 0.055;
	return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

function toHexPair(value: number): string {
	return value.toString(16).padStart(2, "0");
}

/**
 * The built-in palettes are written in oklch, but `input[type=color]` only
 * speaks hex - the theme editor needs one to seed the other.
 */
export function toHexColor(color: string): string {
	if (color.startsWith("#"))
		return color.length === 4 ? expandShortHex(color) : color;

	const match = OKLCH.exec(color);
	if (!match) return "#000000";

	const lightness = match[1].endsWith("%")
		? Number.parseFloat(match[1]) / 100
		: Number.parseFloat(match[1]);
	const chroma = Number.parseFloat(match[2]);
	const hue = (Number.parseFloat(match[3]) * Math.PI) / 180;

	const a = chroma * Math.cos(hue);
	const b = chroma * Math.sin(hue);

	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

	const r = gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
	const g = gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
	const bl = gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

	return `#${toHexPair(r)}${toHexPair(g)}${toHexPair(bl)}`;
}

function expandShortHex(hex: string): string {
	return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
}
