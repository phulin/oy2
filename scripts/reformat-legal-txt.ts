import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_FILES = [
	"public/terms.txt",
	"public/privacy.txt",
	"public/cookies.txt",
];

const filePaths = process.argv.slice(2);
const targets = filePaths.length > 0 ? filePaths : DEFAULT_FILES;

function isBlank(line: string): boolean {
	return line.trim().length === 0;
}

function isRule(line: string): boolean {
	return /^-{8,}\s*$/.test(line);
}

function isListItem(line: string): boolean {
	return /^-\s+/.test(line) || /^\d+[.)]\s+/.test(line);
}

function isLikelyHeading(line: string): boolean {
	const value = line.trim();
	if (value.length === 0) {
		return false;
	}
	if (isRule(value)) {
		return true;
	}
	if (/^[A-Z0-9\s&(),.'":/\-?]+$/.test(value) && /[A-Z]/.test(value)) {
		return true;
	}
	return /^\d+\.\s+[A-Z0-9\s&(),.'":/\-?]+$/.test(value);
}

function normalizeSpaces(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

type ParsedLine = {
	indent: number;
	content: string;
};

function parseLine(rawLine: string): ParsedLine {
	const content = rawLine.trimStart();
	return {
		indent: rawLine.length - content.length,
		content,
	};
}

function unwrapParagraphBuffer(lines: string[]): string[] {
	if (lines.length === 0) {
		return [];
	}

	const unwrapped: string[] = [];
	let activeLine = "";
	let activeIndent = 0;
	let activeIsList = false;

	const flushActiveLine = () => {
		if (activeLine.length === 0) {
			return;
		}
		const prefix =
			activeIsList && activeIndent > 0 ? " ".repeat(activeIndent) : "";
		unwrapped.push(`${prefix}${normalizeSpaces(activeLine)}`);
		activeLine = "";
		activeIndent = 0;
		activeIsList = false;
	};

	for (const rawLine of lines) {
		const { content, indent } = parseLine(rawLine);
		const lineIsList = isListItem(content);
		const lineIsHeading = isLikelyHeading(content);
		const canContinueList = activeIsList && !lineIsList && !lineIsHeading;

		if (activeLine.length === 0) {
			activeLine = content;
			activeIndent = indent;
			activeIsList = lineIsList;
			continue;
		}

		if (
			lineIsHeading ||
			(activeIsList && lineIsList) ||
			(!activeIsList && lineIsList)
		) {
			flushActiveLine();
			activeLine = content;
			activeIndent = indent;
			activeIsList = lineIsList;
			continue;
		}

		if (canContinueList || (!activeIsList && !lineIsHeading)) {
			activeLine = `${activeLine} ${content}`;
			continue;
		}

		flushActiveLine();
		activeLine = content;
		activeIndent = indent;
		activeIsList = lineIsList;
	}

	flushActiveLine();

	return unwrapped;
}

function reformatLegalText(input: string): string {
	const lines = input.replace(/\r\n/g, "\n").split("\n");
	const output: string[] = [];
	let paragraphBuffer: string[] = [];

	const flushParagraphBuffer = () => {
		output.push(...unwrapParagraphBuffer(paragraphBuffer));
		paragraphBuffer = [];
	};

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (isBlank(line) || isRule(line)) {
			flushParagraphBuffer();
			if (output.length === 0 || output.at(-1) !== "") {
				output.push("");
			}
			if (isRule(line)) {
				output.push(line.trim());
				output.push("");
			}
			continue;
		}

		if (isLikelyHeading(line) && paragraphBuffer.length > 0) {
			flushParagraphBuffer();
			if (output.length > 0 && output.at(-1) !== "") {
				output.push("");
			}
		}

		paragraphBuffer.push(line);
	}

	flushParagraphBuffer();

	while (output.length > 0 && output.at(-1) === "") {
		output.pop();
	}

	return `${output.join("\n")}\n`;
}

for (const target of targets) {
	const original = readFileSync(target, "utf8");
	const formatted = reformatLegalText(original);
	writeFileSync(target, formatted, "utf8");
	console.log(`Reformatted ${target}`);
}
