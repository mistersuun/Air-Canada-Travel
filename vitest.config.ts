import { defineConfig, type Plugin } from 'vitest/config';
import ts from 'typescript';
import { constructorParametersDownlevelTransform } from '@angular/compiler-cli/private/tooling';

/**
 * Plain vitest compiles TS with esbuild, which knows nothing about Angular's
 * signal-based APIs. In JIT mode Angular only sees `input()`, `model()`,
 * `output()` and signal queries after the compiler-cli JIT transform has
 * turned them into decorator metadata (the same transform `ng test` uses).
 * This plugin runs that transform on app sources that import @angular/core.
 */
function angularJitTransform(): Plugin {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    experimentalDecorators: true,
    useDefineForClassFields: false,
    importHelpers: false,
    sourceMap: true,
    inlineSources: true,
    noResolve: true,
    noLib: true,
    skipLibCheck: true,
    isolatedModules: true,
  };
  return {
    name: 'angular-jit-transform',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0];
      if (!file.endsWith('.ts') || file.endsWith('.d.ts') || file.includes('/node_modules/')) return null;
      if (!code.includes('@angular/core')) return null;

      const host = ts.createCompilerHost(compilerOptions);
      const baseGetSourceFile = host.getSourceFile.bind(host);
      host.getSourceFile = (name, lang, ...rest) =>
        name === file ? ts.createSourceFile(name, code, lang, true) : baseGetSourceFile(name, lang, ...rest);
      const program = ts.createProgram([file], compilerOptions, host);
      const sourceFile = program.getSourceFile(file)!;

      let js = '';
      let map: string | undefined;
      program.emit(
        sourceFile,
        (name, text) => {
          if (name.endsWith('.map')) map = text;
          else js = text;
        },
        undefined,
        false,
        { before: [constructorParametersDownlevelTransform(program)] },
      );
      js = js.replace(/\n\/\/# sourceMappingURL=.*$/, '');
      return { code: js, map: map ? JSON.parse(map) : null };
    },
  };
}

export default defineConfig({
  plugins: [angularJitTransform()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Measure the whole app so new files show up in the report, but only
      // gate on per-glob thresholds (critique 10): widening `include` must not
      // make `npm test` fail because untested components drag a global average down.
      include: ['src/app/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/**/*.spec.ts',
        'src/app/data/schedules.ts', // generated data
      ],
      thresholds: {
        // Pure logic: the engine must stay well covered.
        'src/app/utils/**/*.ts': { lines: 85, statements: 85, functions: 75, branches: 80 },
        'src/app/data/destinations.ts': { lines: 80, statements: 80, functions: 80, branches: 80 },
        // Shared UI primitives are small and fully testable.
        'src/app/components/shared/**/*.ts': { lines: 80, statements: 80, functions: 80, branches: 70 },
      },
    },
  },
});
