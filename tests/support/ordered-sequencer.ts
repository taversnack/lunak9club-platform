import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Run test files in a fixed (alphabetical) order. They share one database and each picks its own days
 * ahead, so the order decides which days are already used; vitest's default order changes with cached
 * timings, which made a failure depend on the previous run.
 */
export default class OrderedSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}
