// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { snippetCompletion } from "@codemirror/autocomplete";

// Completion snippets offered on top of whatever the language server proposes.

/** JavaScript snippets, also reused by TypeScript. */
export const jsSnippets = [
	snippetCompletion("if (${condition}) {\n\t${}\n}", {
		label: "if",
		detail: "if statement",
		type: "keyword",
	}),
	snippetCompletion("if (${condition}) {\n\t${}\n} else {\n\t${}\n}", {
		label: "ifelse",
		detail: "if/else",
		type: "keyword",
	}),
	snippetCompletion("for (let ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}", {
		label: "for",
		detail: "for loop",
		type: "keyword",
	}),
	snippetCompletion("for (const ${item} of ${iterable}) {\n\t${}\n}", {
		label: "forof",
		detail: "for...of",
		type: "keyword",
	}),
	snippetCompletion("for (const ${key} in ${object}) {\n\t${}\n}", {
		label: "forin",
		detail: "for...in",
		type: "keyword",
	}),
	snippetCompletion("while (${condition}) {\n\t${}\n}", {
		label: "while",
		detail: "while loop",
		type: "keyword",
	}),
	snippetCompletion("function ${name}(${params}) {\n\t${}\n}", {
		label: "function",
		detail: "function declaration",
		type: "keyword",
	}),
	snippetCompletion("const ${name} = (${params}) => {\n\t${}\n}", {
		label: "arrow",
		detail: "arrow function",
		type: "keyword",
	}),
	snippetCompletion("const ${name} = async (${params}) => {\n\t${}\n}", {
		label: "asyncarrow",
		detail: "async arrow",
		type: "keyword",
	}),
	snippetCompletion("async function ${name}(${params}) {\n\t${}\n}", {
		label: "asyncfn",
		detail: "async function",
		type: "keyword",
	}),
	snippetCompletion(
		"class ${Name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}",
		{ label: "class", detail: "class declaration", type: "keyword" },
	),
	snippetCompletion("try {\n\t${}\n} catch (${error}) {\n\t${}\n}", {
		label: "try",
		detail: "try/catch",
		type: "keyword",
	}),
	snippetCompletion(
		"try {\n\t${}\n} catch (${error}) {\n\t${}\n} finally {\n\t${}\n}",
		{ label: "trycf", detail: "try/catch/finally", type: "keyword" },
	),
	snippetCompletion(
		"switch (${expr}) {\n\tcase ${value}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}",
		{ label: "switch", detail: "switch statement", type: "keyword" },
	),
	snippetCompletion("import { ${names} } from '${module}'", {
		label: "import",
		detail: "named import",
		type: "keyword",
	}),
	snippetCompletion("import ${name} from '${module}'", {
		label: "importd",
		detail: "default import",
		type: "keyword",
	}),
	snippetCompletion("export const ${name} = ${value}", {
		label: "exportc",
		detail: "export const",
		type: "keyword",
	}),
	snippetCompletion("export function ${name}(${params}) {\n\t${}\n}", {
		label: "exportf",
		detail: "export function",
		type: "keyword",
	}),
	snippetCompletion("export default ${value}", {
		label: "exportd",
		detail: "export default",
		type: "keyword",
	}),
	snippetCompletion("console.log(${value})", {
		label: "log",
		detail: "console.log",
		type: "function",
	}),
	snippetCompletion("console.error(${value})", {
		label: "logerr",
		detail: "console.error",
		type: "function",
	}),
	snippetCompletion("console.warn(${value})", {
		label: "logwarn",
		detail: "console.warn",
		type: "function",
	}),
	snippetCompletion("const ${name} = await ${promise}", {
		label: "await",
		detail: "await expression",
		type: "keyword",
	}),
	snippetCompletion("new Promise((${resolve}, ${reject}) => {\n\t${}\n})", {
		label: "promise",
		detail: "new Promise",
		type: "function",
	}),
	snippetCompletion("setTimeout(() => {\n\t${}\n}, ${delay})", {
		label: "timeout",
		detail: "setTimeout",
		type: "function",
	}),
];

/** The JavaScript snippets plus the type-level constructs. */
export const tsSnippets = [
	...jsSnippets,
	snippetCompletion("interface ${Name} {\n\t${}\n}", {
		label: "interface",
		detail: "interface declaration",
		type: "keyword",
	}),
	snippetCompletion("type ${Name} = ${definition}", {
		label: "type",
		detail: "type alias",
		type: "keyword",
	}),
	snippetCompletion("enum ${Name} {\n\t${Member},\n}", {
		label: "enum",
		detail: "enum declaration",
		type: "keyword",
	}),
	snippetCompletion("as ${Type}", {
		label: "as",
		detail: "type cast",
		type: "keyword",
	}),
	snippetCompletion("<${Type}>(${value})", {
		label: "cast",
		detail: "angle bracket cast",
		type: "keyword",
	}),
	snippetCompletion("${name}?: ${Type}", {
		label: "optprop",
		detail: "optional property",
		type: "property",
	}),
	snippetCompletion("Record<${Key}, ${Value}>", {
		label: "Record",
		detail: "Record type",
		type: "type",
	}),
	snippetCompletion("Partial<${Type}>", {
		label: "Partial",
		detail: "Partial type",
		type: "type",
	}),
	snippetCompletion("Required<${Type}>", {
		label: "Required",
		detail: "Required type",
		type: "type",
	}),
	snippetCompletion("Readonly<${Type}>", {
		label: "Readonly",
		detail: "Readonly type",
		type: "type",
	}),
	snippetCompletion("Array<${Type}>", {
		label: "Array",
		detail: "Array type",
		type: "type",
	}),
	snippetCompletion("Promise<${Type}>", {
		label: "Promise",
		detail: "Promise type",
		type: "type",
	}),
];
