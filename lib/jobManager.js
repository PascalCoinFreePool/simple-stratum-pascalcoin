var events = require('events');
var crypto = require('crypto');
var bignum = require('bignum');

var randomhash = require('node-randomhash');

var util = require('./util.js');
var blockTemplate = require('./blockTemplate.js');


//Unique extranonce per subscriber
var ExtraNonceCounter = function(configPoolId){

    this.next = function(){
	var str = (configPoolId+'/'+crypto.randomBytes(4).readUInt32LE(0)).padEnd(26, '0');
	var hex = Buffer.from(str, 'utf8').toString('hex');
	return hex;
    };

    this.size = 18; //bytes
};

//Unique job per new block template
var JobCounter = function(){
    var counter = 0;

    this.next = function(){
        counter++;
        if (counter % 0xffff === 0)
            counter = 1;
        return this.cur();
    };

    this.cur = function () {
        return counter.toString(16);
    };
};

/**
 * Emits:
 * - newBlock(blockTemplate) - When a new block (previously unknown to the JobManager) is added, use this event to broadcast new jobs
 * - share(shareData, blockHex) - When a worker submits a share. It will have blockHex if a block was found
 **/
var JobManager = module.exports = function JobManager(options){


    //private members

    var _this = this;
    var jobCounter = new JobCounter();

    //public members

    this.extraNonceCounter = new ExtraNonceCounter(options.poolId);
    this.extraNoncePlaceholder = new Buffer('46726565706f6f6c2f3030303030303030303030303030303030', 'hex');
    this.extraNonce2Size = this.extraNoncePlaceholder.length - this.extraNonceCounter.size;

    this.currentJob;
    this.validJobs = {};

    var blockHasher = function () {
        return util.reverseBuffer(hashDigest.apply(this, arguments));
    }

    this.updateCurrentJob = function(){

        var tmpBlockTemplate = new blockTemplate(
            jobCounter.next(),
            _this.currentJob.rpcData
        );

        _this.currentJob = tmpBlockTemplate;

        _this.emit('updatedBlock', tmpBlockTemplate, true);

        _this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

    };

    //returns true if processed a new block
    this.processTemplate = function(rpcData){

        var tmpBlockTemplate = new blockTemplate(
            jobCounter.next(),
            rpcData
        );

        this.currentJob = tmpBlockTemplate;

        this.validJobs = {};
        _this.emit('newBlock', tmpBlockTemplate);

        this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

        return true;

    };

    this.processShare = function(jobId, previousDifficulty, difficulty, extraNonce1, extraNonce2, nTime, nonce, ipAddress, port, workerName){
        var shareError = function(error){
            _this.emit('share', {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            return {error: error, result: null};
        };

        var submitTime = Date.now() / 1000 | 0;

        if (extraNonce2.length / 2 !== _this.extraNonce2Size)
            return shareError([20, 'incorrect size of extranonce2']);

        var job = this.validJobs[jobId];

        if (typeof job === 'undefined' || job.jobId != jobId ) {
            return shareError([21, 'job not found']);
        }

        if (nTime.length !== 8) {
            return shareError([20, 'incorrect size of ntime']);
        }

        var nTimeInt = parseInt(nTime, 16);
        if (nTimeInt < job.rpcData.curtime || nTimeInt > submitTime + 180) {
            return shareError([20, 'ntime out of range']);
        }

        if (nonce.length !== 16) {
            return shareError([20, 'incorrect size of nonce']);
        }

        if (!job.registerSubmit(extraNonce1, extraNonce2, nTime, nonce)) {
            return shareError([22, 'duplicate share']);
        }

	var payload = extraNonce1 + extraNonce2;

	var blockRpcData = this.validJobs[jobId].rpcData;

	var blockHeader = Buffer.concat([
	    Buffer.from(blockRpcData.part1, 'hex'),
	    Buffer.from(payload, 'hex'),
	    Buffer.from(blockRpcData.part3, 'hex'),
	    Buffer.from(nTime, 'hex').swap32(),
	    Buffer.from(nonce, 'hex').slice(4).swap32()
	]);

	// change this to async
        var blockHash = randomhash.hashSync(blockHeader);

	var block = false;
	
        var headerBigNum = bignum.fromBuffer(blockHash);

        var shareDiff = diff1 / headerBigNum.toNumber();

        //Check if share is a block candidate (matched network difficulty)
        if(job.target.ge(headerBigNum)){
	    // Hooray!
	    block = {
		height: blockRpcData.block,
		payload: payload,
		timestamp: parseInt(nTime, 16),
		nonce: parseInt(nonce, 16)
	    };
        } else {
            //Check if share didn't reached the miner's difficulty)
            if (shareDiff / difficulty < 0.99){

                //Check if share matched a previous difficulty from before a vardiff retarget
                if (previousDifficulty && shareDiff >= previousDifficulty){
                    difficulty = previousDifficulty;
                } else{
                    return shareError([23, 'low difficulty share of ' + shareDiff]);
                }

            }
        }

        _this.emit('share', {
            job: jobId,
            ip: ipAddress,
            port: port,
            worker: workerName,
            height: job.rpcData.height,
            difficulty: difficulty,
            shareDiff: shareDiff.toFixed(8),
            blockDiff: job.difficulty,
            blockHash: blockHash,
        }, block);

        return {result: true, error: null, blockHash: blockHash};
    };
};
JobManager.prototype.__proto__ = events.EventEmitter.prototype;
