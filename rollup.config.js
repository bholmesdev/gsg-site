import svelte from 'rollup-plugin-svelte'
import resolve from 'rollup-plugin-node-resolve'
import serve from 'rollup-plugin-serve'
import livereload from 'rollup-plugin-livereload'

export default {
  input: 'main.js',
  output: {
    file: 'public/build/bundle.js',
    name: 'App',
    format: 'iife',
  },
  plugins: [
    resolve(),
    svelte({
      css: stylesheet => {
        stylesheet.write('public/build/bundle.css')
      },
    }),
    serve({ open: true, contentBase: 'public', port: 5000 }),
    livereload(),
  ],
}
