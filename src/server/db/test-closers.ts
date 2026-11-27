type Close = () => Promise<void>;

const forTest = new Set<Close>();
const forFile = new Set<Close>();
let inTest = false;

export function closeWhenDone(close: Close): void {
  (inTest ? forTest : forFile).add(close);
}

export function startTest(): void {
  inTest = true;
}

async function closeAll(closers: Set<Close>): Promise<void> {
  const failures: unknown[] = [];
  for (const close of [...closers]) {
    closers.delete(close);
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

export async function finishTest(): Promise<void> {
  inTest = false;
  await closeAll(forTest);
}

export async function finishFile(): Promise<void> {
  await closeAll(forFile);
}
