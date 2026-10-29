export function createHistory<T>(limit = 50) {
  const states: T[] = [];
  let index = -1;

  return {
    push(s: T): void {
      states.splice(index + 1);
      states.push(s);
      if (states.length > limit) states.shift();
      index = states.length - 1;
    },
    undo(): T | undefined {
      if (index <= 0) return undefined;
      index -= 1;
      return states[index];
    },
    redo(): T | undefined {
      if (index + 1 >= states.length) return undefined;
      index += 1;
      return states[index];
    },
    canUndo(): boolean {
      return index > 0;
    },
    canRedo(): boolean {
      return index + 1 < states.length;
    },
  };
}
