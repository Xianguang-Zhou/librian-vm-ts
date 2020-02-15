class Statement {

	public readonly type: string;
	public readonly pattern: RegExp;
	public readonly children: Map<string, RegExp> | null;

	public constructor(type: string, pattern: RegExp | string
		, children: Map<string, RegExp> | Array<readonly [string, RegExp]>
			| null = null) {
		this.type = type;
		if (typeof pattern === 'string') {
			pattern = r(pattern);
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
			pattern = r(pattern);
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

function r(s: string): RegExp {
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

	private static readonly statementGroup: Array<Statement> = [
		new Statement('functionCalling',
			/^> *(?<originalText>(?<function>\S*)(?<parameterList>(.*)))$/g, [
			['parameterList',
				/(?<a>(((?<=").*?(?="))|(((?<= )|(?<=^))([^" ]+?)(?=( |$)))))/g]
		]),
		new Statement('embeddedCode',
			/^```(?<codeType>.*?)\n(?<codeContent>(.|\n)*?)\n```$/g),
		new Statement('roleOperation',
			/^@ *(?<roleName>.+?) *(?<operator>[\+\|]) *(?<target>.+?)$/g),
		new Statement('insertedImage',
			/^={3,} *(?<insertedImage>.*) *$/g),
		new Statement('roleDialog',
			/^(?=[^#])(?<name>.+?)(\|(?<alias>.+?))? +(\[(?<effect>.+?)\])? *(\((?<expression>.+?)\))? *(「|“)(?<dialog>(.|\n)*?)(”|」) *$/g),
		new Statement('roleExpression',
			/^(?<name>.+?)(\|(?<alias>.+?))?  *(\[(?<effect>.+?)\])? *(\((?<expression>.+?)\)) *$/g),
		new Statement('scene',
			/^(?<sceneOperator>[\+\-]) *(?<content>.*)$/g),
		new Statement('option',
			/^\? +(?<optionName>.+?) *-> *(?<file>.+?)(, *(?<location>.*?))?$/g),
		new Statement('comment',
			/^#(?<comment>.*)$/g),
		new Statement('jumpPoint',
			/^\* *(?<jumpPoint>.*)$/g)
	];

	private static readonly continuedLineGroup: Array<RegExp> = [
		/^(?=[^#])(.+?)(\|(.+?))? +(\[(?<effect>.+?)\])? *(\((.+?)\))?「([^」]*)$/g,
		/^```(.|\n)*(?<!\n```)$/g
	];

	private static readonly errorGroup: Array<ErrorCondition> = [
		new ErrorCondition('Mismatched quotation mark', /^.*?「[^」]*「.*$/g),
	];

	private static readonly nonBlankPattern: RegExp = /\S/g;

	public parse(source: string): Array<Map<string, string | Array<Map<string, string>> | number>> {
		const lines = source.split('\n').filter(line => line.length > 0);
		return this.parseLines(lines);
	}

	private parseLines(lines: Array<string>): Array<Map<string, string | Array<Map<string, string>> | number>> {
		const nodes: Array<Map<string, string | Array<Map<string, string>> | number>> = [];
		let linesBuffer = '';
		for (const currentLineIndex in lines) {
			let currentLine = lines[currentLineIndex];
			if (!Parser.nonBlankPattern.test(currentLine)) {
				if (nodes.length > 0) {
					const lastLine = nodes.length - 1;
					let lastBlank: number | undefined = nodes[lastLine].get('lastBlank') as number;
					if (lastBlank === undefined) {
						lastBlank = 1;
					} else {
						++lastBlank;
					}
					nodes[lastLine].set('lastBlank', lastBlank);
				}
				continue;
			}

			currentLine = stringRstrip(currentLine, '\r\n');
			if (linesBuffer.length > 0) {
				currentLine = linesBuffer + '\n' + currentLine;
				linesBuffer = '';
			}
			if (Parser.continuedLineGroup.filter(
				pattern => patternMatch(pattern, currentLine)).length > 0) {
				linesBuffer = currentLine;
				console.debug(linesBuffer);
				continue;
			}

			const lineNode = new Map<string, string
				| Array<Map<string, string>> | number>();
			lineNode.set('indentSize',
				currentLine.length
				- stringLstrip(currentLine, ' ').length);

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
			matchedStatements[0].forEach((value, key) => lineNode.set(key, value));
			nodes.push(lineNode);
		}
		return nodes;
	}

	private matchStatements(line: string): Array<Map<string, string
		| Array<Map<string, string>> | number>> {
		const matchedStatements: Array<Map<string, string
			| Array<Map<string, string>> | number>> = [];
		Parser.statementGroup.forEach(rule => {
			patternFindAll(rule.pattern, line).forEach(element => {
				const groupMap: Map<string, string | Array<Map<string, string>>> = groupsObjectToMap(element.groups);
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

	private matchChild(pattern: RegExp, lineElement: string): Array<Map<string, string>> {
		const matchedElements: Array<Map<string, string>> = [];
		patternFindAll(pattern, lineElement).forEach(element => {
			if (element.groups != null) {
				matchedElements.push(groupsObjectToMap(element.groups));
			}
		});
		return matchedElements;
	}
}

export function stringify(nodes: any, space?: number | string | undefined): string {
	return JSON.stringify(nodes, (_propertyName, propertyValue) => {
		if (propertyValue instanceof Map) {
			const obj: {[key: string]: unknown} = {};
			propertyValue.forEach((value, key) => obj[key] = value);
			return obj;
		}
		return propertyValue;
	}, space);
}
