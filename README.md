# C4 model CLI tool

Facilitate the edition of C4 diagrams written in yaml.  
It use the [Structurizr Express](https://structurizr.com/express) to **render** and **edit** diagrams. 

Standalone executable for Linux, Mac and Windows are available on the release page. 

> **Note**: The documentation need to be written

## Usage

```bash
Usage: c4tool [options] [command]


Commands:

edit <filename>    edit a diagram inside Structurizr Express
render <filename>  render a given diagram into PNG
watch <directory>  watch diagrams within a directory and generate PNG when modified

Options:

-h, --help  output usage information
```

## Development

```
# install the project
yarn
# generate executables
yarn run build
```

## ToDo

- [ ] Store properties such as `styles`, `position` and `vectrices` on a separate file
- [ ] Provide a documentation detailing the workflow
- [ ] Support the generation of templates



