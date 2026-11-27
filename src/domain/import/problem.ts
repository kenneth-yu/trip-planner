export class InputProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputProblem";
  }
}
