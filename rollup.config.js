import svelte from 'rollup-plugin-svelte'
import resolve from 'rollup-plugin-node-resolve'
import serve from 'rollup-plugin-serve'
import livereload from 'rollup-plugin-livereload'

const build = {
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
  ],
}

if (process.env.BUILD === 'development')
  build.plugins = [
    ...build.plugins,
    serve({ open: true, contentBase: 'public', port: 5000 }),
    livereload(),
  ]

export default build
