const jp = require('jsonpath');

// transform an array od object's props into a concatened key
const sortKey = (item, props) => props.map((prop) => item[prop]).join('.').replace(' ', '_');

// return the ordering of a list using a list
const ordering = (item, path, props) => {
    return jp.query(item, path).reduce((acc, item, index) => {
        acc[sortKey(item, props)] = index;
        
        return acc;
    }, {});
};

const orderApply = (a, b, order, props) => {
    const length = Object.keys(order).length;
    const aKey   = sortKey(a, props);
    const bKey   = sortKey(b, props);
    const aPos   = (aKey in order) ? order[aKey] : length;
    const bPos   = (bKey in order) ? order[bKey] : length;

    if (aPos < bPos) { return -1 };
    if (aPos > bPos) { return 1 };

    return 0;
};

const sort = (actual, actualJsonPath, actualProperty, initial, initialJsonPath, props) => {
    jp.query(actual, actualJsonPath).forEach((element) => {
        const order = ordering(initial, initialJsonPath(element), props);
        element[actualProperty].sort((a, b) => orderApply(a, b, order, props));
    });
};

module.exports = sort;