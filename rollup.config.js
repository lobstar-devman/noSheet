//https://medium.com/@robinviktorsson/setting-up-a-modern-typescript-project-with-rollup-no-framework-e24a7564394c

import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

import postcss from 'rollup-plugin-postcss';         // Allows importing and bundling CSS (and preprocessors like SCSS)
import serve from 'rollup-plugin-serve';             // Starts a local dev server
import livereload from 'rollup-plugin-livereload';   // Enables live-reloading in the browser on changes
import url from '@rollup/plugin-url';                // Handles importing image and other binary files
import terser from '@rollup/plugin-terser';          // Handles minification to make the bundle smaller

import pkg from './package.json' with { type: "json" };

// Check if we're in development mode (watch mode or explicitly set build mode)
const isDev = process.env.ROLLUP_WATCH === 'true' || process.env.BUILD_MODE === 'dev';

export default [
	// browser-friendly UMD build
	{
		input: 'src/index.ts',
		output: {
			name: 'noSheet',
			file: pkg.browser,
			format: 'umd'
		},
		plugins: [
			resolve(),   // so Rollup can find `ms`
			commonjs(),  // so Rollup can convert `ms` to an ES module
			typescript() // so Rollup can convert TypeScript to JavaScript
		]
	},

	// CommonJS (for Node) and ES module (for bundlers) build.
	// (We could have three entries in the configuration array
	// instead of two, but it's quicker to generate multiple
	// builds from a single configuration where possible, using
	// an array for the `output` option, where we can specify 
	// `file` and `format` for each target)
	{
		input: 'src/index.ts',
		external: ['ms'],
		plugins: [
			typescript() // so Rollup can convert TypeScript to JavaScript
		],
		output: [
			{ file: pkg.main, format: 'cjs', sourcemap: true },
			{ file: pkg.module, format: 'es', sourcemap: true }
		]
	},
    ...(isDev ? [                      // Development-only plugins (enabled when in dev mode)
      serve({
        open: true,                    // Automatically open the browser when the server starts
        contentBase: ['dist', 'examples'],  // Folders to serve static files from
        port: 8181                     // Port to run the dev server on
      }),
      livereload(['dist', 'examples']) // Watch the 'dist' and 'examples' directories and reload browser on changes
    ] : [])	
];