import {Dict, Node} from './parser';
import {
	Compiler, Instruction, NodeInstruction, CallInstruction, GotoInstruction,
	AdvEndInstruction, ChoiceInstruction, Option
} from './compiler';

export class VmError extends Error {}

export class Module {

	public constructor(public readonly instructions: Array<Instruction>,
		public readonly path: string) {
	}
}

export abstract class Environment {

	public async abstract modulePathEquals(p1: string, p2: string)
		: Promise<boolean>;

	protected abstract loadModuleCallback(
		targetModulePath: string,
		currentModulePath: string,
		callback: (module: Module) => void,
		failureCallback: (reason: any) => void
	): void;

	public async loadModule(
		targetModulePath: string,
		currentModulePath: string,
	): Promise<Module> {
		return new Promise((resolve, reject) => {
			try {
				this.loadModuleCallback(targetModulePath, currentModulePath,
					resolve, reject);
			} catch (ex) {
				reject(ex);
			}
		});
	}
}

export class PausePoint {}

export class Aside extends PausePoint {

	public aside: string;

	public constructor(node: Node) {
		super();
		this.aside = node['aside'] as string;
	}
}

export class RoleDialog extends PausePoint {

	public name: string;
	public alias: string;
	public effect: string;
	public expression: string;
	public dialog: string;

	public constructor(node: Node) {
		super();
		this.name = node['name'] as string;
		this.alias = node['alias'] as string;
		this.effect = node['effect'] as string;
		this.expression = node['expression'] as string;
		this.dialog = node['dialog'] as string;
	}
}

export class InsertedImage extends PausePoint {

	public insertedImage: string;

	public constructor(node: Node) {
		super();
		this.insertedImage = node['insertedImage'] as string;
	}
}

export class Options extends PausePoint {

	public optionNames: Array<string>;

	public constructor(options: Array<Option>) {
		super();
		this.optionNames = options.map(option => option.name);
	}
}

export class FunctionCalling {

	public originalText: string;
	public functionName: string;
	public parameterList: Array<string>;

	public constructor(node: Node) {
		this.originalText = node['originalText'] as string;
		this.functionName = node['function'] as string;
		this.parameterList = (node['parameterList'] as Array<Dict<string>>)
			.map(paramDict => paramDict['a']);
	}
}

export class RoleOperation {

	public roleName: string;
	public operator: string;
	public target: string;

	public constructor(node: Node) {
		this.roleName = node['roleName'] as string;
		this.operator = node['operator'] as string;
		this.target = node['target'] as string;
	}
}

export class RoleExpression {

	public name: string;
	public alias: string;
	public effect: string;
	public expression: string;

	public constructor(node: Node) {
		this.name = node['name'] as string;
		this.alias = node['alias'] as string;
		this.effect = node['effect'] as string;
		this.expression = node['expression'] as string;
	}
}

export class Scene {

	public sceneOperator: string;
	public content: string;

	public constructor(node: Node) {
		this.sceneOperator = node['sceneOperator'] as string;
		this.content = node['content'] as string;
	}
}

export class Output {

	public pausePoint: PausePoint | null = null;
	public functionCallings: Map<String, FunctionCalling> = new Map();
	public roleOperation: RoleOperation | null = null;
	public roleExpression: RoleExpression | null = null;
	public scene: Scene | null = null;

	public addFunctionCalling(calling: FunctionCalling): void {
		this.functionCallings.set(calling.functionName, calling);
	}
}

export class Input {

	public optionIndex: number | null | undefined;
}

export class VM {

	private readonly stack: Array<Frame> = [];
	private choice: ChoiceInstruction | null = null;

	public constructor(startModule: Module, private readonly compiler: Compiler,
		private readonly env: Environment) {
		this.stack.push(new Frame(startModule));
	}

	private getFrame(): Frame {
		return this.stack[this.stack.length - 1];
	}

	private isStackEmpty(): boolean {
		return this.stack.length === 0;
	}

	private emptyStack(): void {
		this.stack.splice(0);
	}

	public async nextOutput(input?: Input | null | undefined):
		Promise<Output | null> {
		if (this.choice != null) {
			const currentFrame = this.getFrame();
			if (currentFrame == null) {
				return null;
			}
			if (input == null) {
				throw new VmError('"input" is null.');
			}
			if (input.optionIndex == null) {
				throw new VmError('"input.optionIndex" is null.');
			}
			const selectedOption = this.choice.options[input.optionIndex];
			if (selectedOption == null) {
				throw new VmError('"input.optionIndex" is out of range.');
			}
			currentFrame.insertInstructions([new CallInstruction(
				selectedOption.path, selectedOption.tag, true)]);
			this.choice = null;
		}

		do {
			if (this.isStackEmpty()) {
				return null;
			}
			const currentFrame = this.getFrame();
			if (currentFrame.isEnded()) {
				this.stack.pop();
			} else {
				break;
			}
		} while (true);

		const output = new Output();
		do {
			if (this.isStackEmpty()) {
				break;
			}
			const currentFrame = this.getFrame();
			if (currentFrame.isEnded()) {
				this.stack.pop();
				continue;
			}
			const currentInstruction = currentFrame.getInstruction();
			currentFrame.nextInstruction();
			switch (currentInstruction.itype) {
				case 'aside': {
					const currentNode = (currentInstruction as NodeInstruction).node;
					output.pausePoint = new Aside(currentNode);
				} break;
				case 'functionCalling': {
					const currentNode = (currentInstruction as NodeInstruction).node;
					const calling = new FunctionCalling(currentNode);
					output.addFunctionCalling(calling);
				} break;
				case 'embeddedCode': {
					const currentNode = (currentInstruction as NodeInstruction).node;
					const codeContent = currentNode['codeContent'] as string;
					const generatedInstructions: Array<Instruction> = [];
					evaluate(codeContent, {
						'fusion': (source: string) => {
							generatedInstructions.push(...this.compiler.
								compile(source, true));
						},
						'goto': (path: string | null = null,
							tag: string | null = null) => {
							generatedInstructions.push(new GotoInstruction(
								path, tag, true));
						},
						'choice': (...options: Array<[string, string, string]>) => {
							generatedInstructions.push(new ChoiceInstruction(
								options.map(tuple => new Option(
									tuple[0], tuple[1], tuple[2])), true));
						},
						'adv_end': () => {
							generatedInstructions.push(new AdvEndInstruction(true));
						},
						'call': (path: string | null = null,
							tag: string | null = null) => {
							generatedInstructions.push(new CallInstruction(
								path, tag, true));
						}
					});
					currentFrame.insertInstructions(generatedInstructions);
				} break;
				case 'roleOperation': {
					const currentNode = (currentInstruction as NodeInstruction).node;
					output.roleOperation = new RoleOperation(currentNode);
				} break;
				case 'insertedImage': {
					const currentNode = (currentInstruction as NodeInstruction).node;
					output.pausePoint = new InsertedImage(currentNode);
				} break;
				case 'roleDialog': {
					const currentNode = (currentInstruction as NodeInstruction).node;
					output.pausePoint = new RoleDialog(currentNode);
				} break;
				case 'roleExpression': {
					const currentNode = (currentInstruction as NodeInstruction).node;
					output.roleExpression = new RoleExpression(currentNode);
				} break;
				case 'scene': {
					const currentNode = (currentInstruction as NodeInstruction).node;
					output.scene = new Scene(currentNode);
				} break;
				case 'choice': {
					const instruction = currentInstruction as ChoiceInstruction;
					output.pausePoint = new Options(instruction.options);
					this.choice = instruction;
				} break;
				case 'jumpPoint': break;
				case 'call': {
					const instruction = currentInstruction as CallInstruction;
					let targetFrame = null;
					if (instruction.path != null
						&& instruction.path.length > 0
						&& !await this.env.modulePathEquals(instruction.path,
							currentFrame.modulePath)) {
						targetFrame = new Frame(await this.env.loadModule(
							instruction.path, currentFrame.modulePath));
					} else {
						targetFrame = Frame.fromOther(currentFrame);
					}
					this.stack.push(targetFrame);
					targetFrame.jump(instruction.tag);
				} break;
				case 'goto': {
					const instruction = currentInstruction as GotoInstruction;
					let targetFrame = currentFrame;
					if (instruction.path != null
						&& instruction.path.length > 0
						&& !await this.env.modulePathEquals(instruction.path,
							currentFrame.modulePath)) {
						targetFrame = new Frame(await this.env.loadModule(
							instruction.path, currentFrame.modulePath));
						this.stack.pop();
						this.stack.push(targetFrame);
					}
					targetFrame.jump(instruction.tag);
				} break;
				case 'adv_end': {
					this.emptyStack();
				} break;
				default: {
					throw new VmError(
						`Unknown "${currentInstruction.itype}" instruction.`);
				}
			}
		} while (output.pausePoint === null);
		return output;
	}

	public nextOutputCallback(callback: (output: Output | null) => void,
		failureCallback: (reason: any) => void,
		input?: Input | null | undefined): void {
		this.nextOutput(input).then(callback, failureCallback);
	}
}

class Frame {

	private readonly instructions: Array<Instruction> = [];
	private programCounter: number = 0;
	public readonly modulePath: string;

	private readonly originalInstructions: Array<Instruction> = [];

	public constructor(module: Module) {
		this.modulePath = module.path;
		this.instructions = module.instructions.slice(0);
		this.originalInstructions = module.instructions.slice(0);
	}

	public static fromOther(other: Frame): Frame {
		return new Frame(new Module(other.originalInstructions, other.modulePath));
	}

	public jump(tag: string | null): void {
		if (tag != null) {
			for (let index = 0; index < this.instructions.length; ++index) {
				const instruction = this.instructions[index];
				if (instruction.itype === 'jumpPoint') {
					const nodeInstruction = instruction as NodeInstruction;
					if (nodeInstruction.node['jumpPoint'] === tag) {
						this.programCounter = index;
						return;
					}
				}
			}
			throw new VmError(
				`Can not find "${tag}" jump point in "${this.modulePath}".`);
		} else {
			this.programCounter = 0;
		}
	}

	public insertInstructions(instructions: Array<Instruction>): void {
		if (instructions.length > 0) {
			this.instructions.splice(this.programCounter, 0,
				...instructions);
		}
	}

	public isEnded(): boolean {
		return this.programCounter >= this.instructions.length;
	}

	public getInstruction(): Instruction {
		return this.instructions[this.programCounter];
	}

	public nextInstruction(): void {
		const instruction = this.instructions[this.programCounter];
		if (instruction.isDisposable) {
			this.instructions.splice(this.programCounter, 1);
		} else {
			this.programCounter++;
		}
	}
}

function evaluate(source: string, globalVariables: Dict<unknown> = {})
	: unknown {
	const names = Object.keys(globalVariables);
	const values = Object.values(globalVariables);
	const func = new Function(
		`return function (${names}) { return (${source}); }`)();
	return func(...values);
}
