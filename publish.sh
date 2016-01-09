#!/bin/bash

# Copyright (c) 2015 Uber Technologies, Inc.
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.

set -e
set -x

if [ -z "$1" ]; then
    echo "must pass in version as first arg" >&2
    exit 1
fi

# npm version will ensure the git working directory is clean
npm version "$1"

if head_ref=$(git symbolic-ref HEAD 2>/dev/null); then
    branch_name=${head_ref##*/}
    git push origin "$branch_name" --tags
else
    git push origin --tags
fi

# run the replacer script to make all logsites check for sampling
git ls-files | grep '.js$' | grep -v 'bin/' | grep -v test | grep -v replacer.js | xargs node replacer.js

# need a temp commit because git archive uses HEAD
git commit -a -m 'temp commit'

git archive --prefix=package/ --format tgz HEAD >package.tgz
${NPM:-npm} publish --registry=https://registry.npmjs.org/ package.tgz --tag "${NPM_TAG:-alpha}"
rm package.tgz
npm cache clean hyperbahn

# un-replacer.js all of the files we touched
git reset --hard HEAD~
