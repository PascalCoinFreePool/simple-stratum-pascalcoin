var net = require("net");
var events = require("events");
var pool = require("./pool.js");

exports.createPool = function(poolOptions, authorizeFn, log){
    var newPool = new pool(poolOptions, authorizeFn);
    return newPool;
};
