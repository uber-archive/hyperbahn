var fs = require('fs');

function replace(level, line) {
    if (line.indexOf('logger.' + level) !== -1) {
        var matches = line.match(/( *)([a-z\.]*logger).[a-z]*(.*)/);
        if (!matches) {
            throw new Error('couldn\'t match log line in replacer.js');
        }
        var whitespace = matches[1];
        var logger = matches[2];
        var restOfLine = matches[3];

        var ifStatement = whitespace + 'if (' + logger + '.willSample(\'' + level + '\')) ';
        var logCall = logger + '.s' + level + restOfLine;

        return ifStatement + logCall;
    } else {
        return line;
    }
}

var input = process.argv[2];
var contents = fs.readFileSync(input, 'utf8').split('\n');
var i;
var levels = ['debug', 'info', 'warn', 'error', 'trace'];
for (i = 0; i < contents.length; i++) {
    if (contents[i].indexOf('logger.') !== -1) {
        levels.forEach(function eachLevel(level) {
            contents[i] = replace(level, contents[i]);
        });
    }
}

fs.writeFileSync(input, contents.join('\n'));
