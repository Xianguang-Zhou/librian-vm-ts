import {Parser, Node} from './parser';

export class Compiler {

	public constructor(private readonly parser: Parser) {}

	public compile(source: string | Array<Node>,
		isDisposable = false): Array<Instruction> {
		const nodes: Array<Node> = typeof (source) === 'string'
			? this.parser.parse(source)
			: source;
		const instructions: Array<Instruction> = [];
		let options: Array<Node> = [];
		nodes.forEach(node => {
			if (options.length > 0) {
				switch (node['type']) {
					case 'option': {
						options.push(node);
					} break;
					case 'comment': {
						instructions.push(ChoiceInstruction.fromNodes(
							options, isDisposable));
						options = [];
					} break;
					default: {
						instructions.push(ChoiceInstruction.fromNodes(
							options, isDisposable));
						options = [];
						instructions.push(new NodeInstruction(node, isDisposable));
					}
				}
			} else {
				switch (node['type']) {
					case 'option': {
						options.push(node);
					} break;
					case 'comment': break;
					default: {
						instructions.push(new NodeInstruction(node, isDisposable));
					}
				}
			}
		});
		if (options.length > 0) {
			instructions.push(ChoiceInstruction.fromNodes(
				options, isDisposable));
		}
		return instructions;
	}
}

export abstract class Instruction {

	public constructor(public readonly itype: string,
		public readonly isDisposable = false) {}
}

export class NodeInstruction extends Instruction {

	public constructor(public readonly node: Node,
		isDisposable = false) {
		super(node['type'] as string, isDisposable);
	}
}

export class CallInstruction extends Instruction {

	public constructor(public readonly path: string | null = null,
		public readonly tag: string | null = null, isDisposable = false) {
		super('call', isDisposable);
	}
}

export class GotoInstruction extends Instruction {

	public constructor(public readonly path: string | null = null,
		public readonly tag: string | null = null, isDisposable = false) {
		super('goto', isDisposable);
	}
}

export class AdvEndInstruction extends Instruction {

	public constructor(isDisposable = false) {
		super('adv_end', isDisposable);
	}
}

export class Option {

	public constructor(public readonly name: string,
		public readonly pathOrCodeContent: string | null = null,
		public readonly tagOrCodeType: string | null = null) {
	}

	public static fromNode(node: Node): Option {
		return new Option(node['optionName'] as string,
			node['file'] as string,
			node['location'] as string);
	}
}

export class ChoiceInstruction extends Instruction {

	public constructor(public readonly options: Array<Option>,
		isDisposable = false, public readonly isEmbeddedCode = false) {
		super('choice', isDisposable);
	}

	public static fromNodes(nodes: Array<Node>,
		isDisposable = false): ChoiceInstruction {
		return new ChoiceInstruction(
			nodes.map(node => Option.fromNode(node)), isDisposable, false);
	}
}
