## Installation

```
npm install edx-archive -g
```

## Usage example

```
edx-archive -u your@email.com -p edx_password "https://courses.edx.org/courses/edX/DemoX/Demo_Course/course/"
```

## Full list of options

```
Usage: edx-archive [options] <course_url>

Options:
  -u, --user <email>          edx login (email)
  -p, --password <password>   edx password
  -o, --output <directory>    output directory (default: "Archive")
  -f, --format <format>       save pages as pdf or png (default: "pdf")
  -r, --retries <retries>     number of retry attempts in case of failure (default: 3)
  -d, --delay <seconds>       delay before saving page (default: 1)
  -c, --concurrency <number>  number of pages to save in parallel (default: 4)
  --debug                     output extra debugging (default: false)
  -h, --help                  output usage information
```
