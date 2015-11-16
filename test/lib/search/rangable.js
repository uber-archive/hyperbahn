// Copyright (c) 2015 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

function ScalarRangable(field, value) {
    if (!(this instanceof ScalarRangable)) {
        return new ScalarRangable(field, value);
    }
    this.field = field;
    this.value = value;
}

ScalarRangable.prototype.toString =
function toString() {
    return this.field + ' = ' + this.value;
};

ScalarRangable.prototype.inspect =
function inspect() {
    return 'ScalarRangable(' + JSON.stringify(this.field) +
           ', ' + this.value + ')';
};

ScalarRangable.prototype.fillTemplate =
function fillTemplate(obj) {
    obj[this.field] = 0;
    return obj;
};

ScalarRangable.prototype.withEach =
function withEach(obj, each) {
    obj[this.field] = this.value;
    each(obj);
};

function RangeRangable(field, start, end) {
    if (!(this instanceof RangeRangable)) {
        return new RangeRangable(field, start, end);
    }
    this.field = field;
    this.start = start;
    this.end = end;
}

RangeRangable.prototype.toString =
function toString() {
    return this.start + ' <= ' + this.field + ' <= ' + this.end;
};

RangeRangable.prototype.inspect =
function inspect() {
    return 'RangeRangable(' + JSON.stringify(this.field) +
           ', ' + this.start + ', ' + this.end + ')';
};

RangeRangable.prototype.fillTemplate =
function fillTemplate(obj) {
    obj[this.field] = 0;
    return obj;
};

RangeRangable.prototype.withEach =
function withEach(obj, each) {
    for (var value = this.start; value <= this.end; value++) {
        obj[this.field] = value;
        each(obj);
    }
};

function ChainRangable(rangables) {
    if (!(this instanceof ChainRangable)) {
        return new ChainRangable(rangables);
    }
    this.rangables = rangables;
}

ChainRangable.prototype.toString =
function toString() {
    return this.rangables.join(' & ');
};

ChainRangable.prototype.inspect =
function inspect() {
    var parts = [];
    for (var i = 0; i < this.rangables.length; i++) {
        parts.push(this.rangables[i].inspect());
    }
    return 'ChainRangable([' + parts.join(', ') + '])';
};

ChainRangable.prototype.fillTemplate =
function fillTemplate(obj) {
    for (var i = 0; i < this.rangables.length; i++) {
        obj = this.rangables[i].fillTemplate(obj);
    }
    return obj;
};

ChainRangable.prototype.withEach =
function withEach(theobj, each) {
    var self = this;

    nextRangable(theobj, 0);

    function nextRangable(obj, i) {
        if (i >= self.rangables.length) {
            each(obj);
            return;
        }

        var rangable = self.rangables[i];
        rangable.withEach(obj, underEachRangable);

        function underEachRangable(item) {
            nextRangable(item, i + 1);
        }
    }
};

module.exports.Scalar = ScalarRangable;
module.exports.Range = RangeRangable;
module.exports.Chain = ChainRangable;
