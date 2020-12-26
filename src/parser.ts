export type Dict<T> = {[key: string]: T};
export type Node = Dict<string | Array<Dict<string>> | number>;

class Statement {

	public readonly type: string;
	public readonly pattern: RegExp;
	public readonly children: Map<string, RegExp> | null;

	public constructor(type: string, pattern: RegExp | string
		, children: Map<string, RegExp> | Array<readonly [string, RegExp]>
			| null = null) {
		this.type = type;
		if (typeof pattern === 'string') {
			pattern = re(pattern);
		}
		this.pattern = pattern;
		if (children !== null) {
			if (children instanceof Array) {
				children = new Map(children);
			}
			this.children = children;
		} else {
			this.children = null;
		}
	}
}

class ErrorCondition {

	public readonly prompt: string;
	public readonly pattern: RegExp;

	public constructor(prompt: string, pattern: RegExp | string) {
		this.prompt = prompt;
		if (typeof pattern === 'string') {
			pattern = re(pattern);
		}
		this.pattern = pattern;
	}
}

export class LibrianSyntaxError extends Error {}

function stringRstrip(str: string, chars = ' \t\r\n'): string {
	const codes: Array<number> = [];
	let index = 0;
	while (index < chars.length) {
		codes.push(chars.charCodeAt(index++));
	}
	index = str.length;
	while (index > 0) {
		const strCode = str.charCodeAt(--index);
		if (!(strCode in codes)) {
			break;
		}
	}
	return str.substring(0, index + 1);
}

function stringLstrip(str: string, chars = ' \t\r\n'): string {
	const codes: Array<number> = [];
	let index = 0;
	while (index < chars.length) {
		codes.push(chars.charCodeAt(index++));
	}
	index = 0;
	while (index < str.length) {
		const strCode = str.charCodeAt(index++);
		if (!(strCode in codes)) {
			break;
		}
	}
	return str.substring(index - 1);
}

const r = String.raw;

function re(s: string): RegExp {
	return RegExp(s, 'g');
}

function patternMatch(pattern: RegExp, str: string): boolean {
	const results = pattern.exec(str);
	if (results != null) {
		pattern.lastIndex = 0;
		return results.index === 0;
	}
	return false;
}

function patternFindAll(pattern: RegExp, str: string): Array<RegExpExecArray> {
	const results: Array<RegExpExecArray> = [];
	let result = pattern.exec(str);
	while (result != null) {
		results.push(result);
		result = pattern.exec(str);
	}
	return results;
}

function groupsObjectToMap(obj: {[key: string]: string} | undefined | null): Map<string, string> {
	const map = new Map<string, string>();
	for (const name in obj) {
		map.set(name, obj[name]);
	}
	return map;
}

export class Parser {

	private static readonly identifier: string = r`[^\#\>\"\+\-\=\ ]+?`;

	private static readonly statementGroup: Array<Statement> = [
		new Statement('functionCalling',
			/^> *(?<originalText>(?<function>\S*)(?<parameterList>(.*)))$/g, [
			['parameterList',
				/(?<a>(((?<=").*?(?="))|(((?<= )|(?<=^))([^" ]+?)(?=( |$)))))/g]
		]),
		new Statement('embeddedCode',
			/^```(?<codeType>.*?)\n((?<codeContent>(.|\n)*?)\n)?```$/g),
		new Statement('characterOperation',
			r`^@ *(?<characterName>${Parser.identifier}) *(?<operator>[\+\|]) *(?<target>${Parser.identifier})$`),
		new Statement('insertedImage',
			/^={3,} *(?<insertedImage>.*) *$/g),
		new Statement('characterDialog',
			r`^(?=[^#:])(?<name>${Parser.identifier})(\|(?<alias>${Parser.identifier}))? *(\[(?<effect>${Parser.identifier})\])? *(\((?<expression>${Parser.identifier})\))? *[「“"](?<dialog>(.|\n)*?)["”」] *$`),
		new Statement('characterDialog',
			r`^(?=[^#:])(?<name>${Parser.identifier})(\|(?<alias>${Parser.identifier}))? *(\[(?<effect>${Parser.identifier})\])? *(\((?<expression>${Parser.identifier})\))? *[🐴：:] *(?<dialog>(.|\n)*?) *$`),
		new Statement('characterExpression',
			r`^(?<name>${Parser.identifier})(\|(?<alias>${Parser.identifier}))?  +(\[(?<effect>${Parser.identifier})\])? *(\((?<expression>${Parser.identifier})\)) *$`),
		new Statement('scene',
			/^(?<sceneOperator>[\+\-]) *(?<content>.*)$/g),
		new Statement('option',
			r`^\? +(?<optionName>${Parser.identifier}) *-> *(?<file>${Parser.identifier})(, *(?<location>${Parser.identifier}))?$`),
		new Statement('comment',
			/^#(?<comment>.*)$/g),
		new Statement('aside', /^: *(?<aside>.*)$/g),
		new Statement('jumpPoint',
			/^\* *(?<jumpPoint>.*)$/g)
	];

	private static readonly continuedLineGroup: Array<RegExp> = [
		/^(?<effectiveWord>(.|\n)*)\\$/g,
		re(r`^(?=[^#])(${Parser.identifier})(\|(${Parser.identifier}))? +(\[(?<effect>${Parser.identifier})\])? *(\((${Parser.identifier})\))?「([^」]*)$`),
		/^```(.|\n)*(?<!\n```)$/g
	];

	private static readonly errorGroup: Array<ErrorCondition> = [
		new ErrorCondition('Mismatched quotation mark', /^.*?「[^」]*「.*$/g),
	];

	private static readonly nonBlankPattern: RegExp = /\S/g;

	public parse(source: string): Array<Node> {
		const lines = source.split('\n').filter(line => line.length > 0);
		lines.push('');
		const nodes = this.parseLines(lines);
		if (nodes.length > 0) {
			delete nodes[nodes.length - 1]['lastBlank'];
		}
		return nodes;
	}

	private parseLines(lines: Array<string>): Array<Node> {
		const nodes: Array<Node> = [];
		let linesBuffer = '';
		for (const currentLineIndex in lines) {
			let currentLine = lines[currentLineIndex];
			if (!Parser.nonBlankPattern.test(currentLine)) {
				if (nodes.length > 0) {
					const lastLine = nodes.length - 1;
					let lastBlank: number | undefined = nodes[lastLine]['lastBlank'] as number;
					if (lastBlank === undefined) {
						lastBlank = 1;
					} else {
						++lastBlank;
					}
					nodes[lastLine]['lastBlank'] = lastBlank;
				}
				continue;
			}

			currentLine = stringRstrip(currentLine, '\r\n');
			if (linesBuffer.length > 0) {
				currentLine = linesBuffer + '\n' + currentLine;
				linesBuffer = '';
			}
			const matchedContinuedLinePatterns = Parser.continuedLineGroup.filter(
				pattern => patternMatch(pattern, currentLine));
			if (matchedContinuedLinePatterns.length > 0) {
				let effectiveWord: string | null = null;
				const groups = patternFindAll(matchedContinuedLinePatterns[0], currentLine)[0].groups;
				for (const name in groups) {
					if ('effectiveWord' === name) {
						effectiveWord = groups['effectiveWord'];
						break;
					}
				}
				linesBuffer = effectiveWord != null ? effectiveWord : currentLine;
				console.debug(linesBuffer);
				continue;
			}

			const lineNode: Node = {};
			lineNode['indentSize'] = currentLine.length
				- stringLstrip(currentLine, ' ').length;

			currentLine = stringRstrip(stringLstrip(currentLine, ' '), ' ');
			Parser.errorGroup.forEach(errorCondition => {
				if (patternMatch(errorCondition.pattern, currentLine)) {
					throw new LibrianSyntaxError(`${errorCondition.prompt} in "${currentLine}".`);
				}
			});

			const matchedStatements = this.matchStatements(currentLine);
			if (matchedStatements.length === 0) {
				matchedStatements.push(new Map([['type', 'aside'], ['aside', currentLine]]));
			}
			if (matchedStatements.length > 1) {
				throw new LibrianSyntaxError(`"${currentLine}" matched too many statements. The statements may be ${matchedStatements.map(i => '"' + i.get('type') + '"').join(', ')}.`);
			}
			matchedStatements[0].forEach((value, key) => lineNode[key] = value);
			nodes.push(lineNode);
		}
		return nodes;
	}

	private matchStatements(line: string): Array<Map<string, string
		| Array<Dict<string>> | number>> {
		const matchedStatements: Array<Map<string, string
			| Array<Dict<string>> | number>> = [];
		Parser.statementGroup.forEach(rule => {
			patternFindAll(rule.pattern, line).forEach(element => {
				const groupMap: Map<string, string | Array<Dict<string>>> = groupsObjectToMap(element.groups);
				groupMap.set('type', rule.type);
				if (rule.children != null) {
					rule.children.forEach((childPattern, childType) =>
						groupMap.set(childType, this.matchChild(childPattern, groupMap.get(childType) as string)));
				}
				matchedStatements.push(groupMap);
			});
		});
		return matchedStatements;
	}

	private matchChild(pattern: RegExp, lineElement: string): Array<Dict<string>> {
		const matchedElements: Array<Dict<string>> = [];
		patternFindAll(pattern, lineElement).forEach(element => {
			if (element.groups != null) {
				matchedElements.push(element.groups);
			}
		});
		return matchedElements;
	}
}
