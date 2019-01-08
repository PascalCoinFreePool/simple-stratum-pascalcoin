var bignum = require('bignum');

var util = require('./util.js');

/**
 * The BlockTemplate class holds a single job.
 * and provides several methods to validate and submit it to the daemon coin
**/
var BlockTemplate = module.exports = function BlockTemplate(jobId, rpcData) {

    //private members

    var submits = [];

    //public members

    this.rpcData = rpcData;
    this.jobId = jobId;

    this.target = bignum(rpcData.target_pow, 16);

    this.difficulty = parseFloat((diff1 / this.target.toNumber()).toFixed(9));

    this.registerSubmit = function(extraNonce1, extraNonce2, nTime, nonce){
        var submission = extraNonce1 + extraNonce2 + nTime + nonce;
        if (submits.indexOf(submission) === -1){
            submits.push(submission);
            return true;
        }
        return false;
    };

    this.getJobParams = function(){
        if (!this.jobParams){
            this.jobParams = [
                this.jobId,
                "0000000000000000000000000000000000000000000000000000000000000000",
                this.rpcData.part1,
                this.rpcData.part3,
                [],
                "00000000",
                "10000000",
                util.packUInt32BE(this.rpcData.timestamp).toString('hex'),
                true
            ];
        }
        return this.jobParams;
    };
};
