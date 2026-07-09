```markdown
# granbridge Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `granbridge` TypeScript codebase. You'll learn the project's file organization, import/export styles, commit message practices, and how to write and run tests using Vitest. This guide also provides suggested commands for common development workflows.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myModule.ts`, `userProfile.ts`

### Import Style
- Use **relative imports** for referencing other modules within the project.
  - Example:
    ```typescript
    import { myFunction } from './utils';
    ```

### Export Style
- Use **named exports** rather than default exports.
  - Example:
    ```typescript
    // In utils.ts
    export function myFunction() { /* ... */ }

    // In another file
    import { myFunction } from './utils';
    ```

### Commit Messages
- No strict format, but some commits use the `harden` prefix.
- Commit messages are typically freeform and average around 69 characters.
  - Example:  
    ```
    harden: improve input validation for bridge transactions
    ```

## Workflows

### Testing
**Trigger:** When you want to run the test suite to verify code correctness.
**Command:** `/test`

1. Ensure you have all dependencies installed.
2. Run the Vitest test runner to execute all `*.test.ts` files.
   ```bash
   npx vitest
   ```
3. Review the output for passing and failing tests.

### Adding a New Module
**Trigger:** When you need to add a new feature or utility.
**Command:** `/add-module`

1. Create a new file using camelCase naming (e.g., `newFeature.ts`).
2. Use named exports for your functions or constants.
   ```typescript
   // newFeature.ts
   export function doSomething() { /* ... */ }
   ```
3. Import your module using a relative path where needed.
   ```typescript
   import { doSomething } from './newFeature';
   ```
4. Add corresponding tests in a file named `newFeature.test.ts`.

### Writing Tests
**Trigger:** When you need to add or update tests for your code.
**Command:** `/write-test`

1. Create a test file with the `.test.ts` suffix (e.g., `myModule.test.ts`).
2. Use Vitest's testing API.
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { myFunction } from './myModule';

   describe('myFunction', () => {
     it('should return true for valid input', () => {
       expect(myFunction('valid')).toBe(true);
     });
   });
   ```
3. Run `/test` to verify your tests.

## Testing Patterns

- All tests are written in files matching the `*.test.ts` pattern.
- The project uses **Vitest** as the testing framework.
- Example test:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { add } from './mathUtils';

  describe('add', () => {
    it('adds two numbers', () => {
      expect(add(2, 3)).toBe(5);
    });
  });
  ```

## Commands
| Command      | Purpose                                      |
|--------------|----------------------------------------------|
| /test        | Run the full test suite with Vitest          |
| /add-module  | Scaffold a new module with conventions       |
| /write-test  | Create a new test file for a module          |
```
