var net = require('net');
var events = require('events');

var Pool = require('./lib/pool.js');
//var varDiff = require('./lib/varDiff.js');

global.diff1 = 0x00000000ffff0000000000000000000000000000000000000000000000000000;


var pool = new Pool({
    "coin": {
	"name": "PascalCoin",
	"symbol": "PASC",
	"algorithm": "RandomHash",
    },

    /* Some miner apps will consider the pool dead/offline if it doesn't receive anything new jobs
       for around a minute, so every time we broadcast jobs, set a timeout to rebroadcast
       in this many seconds unless we find a new job. Set to zero or remove to disable this. */
    "jobRebroadcastTimeout": 55,

    "poolId": "Testpool",

    /* Some attackers will create thousands of workers that use up all available socket connections,
       usually the workers are zombies and don't submit shares after connecting. This features
       detects those and disconnects them. */
    "connectionTimeout": 600, //Remove workers that haven't been in contact for this many seconds

    /* Sometimes you want the block hashes even for shares that aren't block candidates. */
    "emitInvalidBlockHashes": false,

    /* Enable for client IP addresses to be detected when using a load balancer with TCP proxy
       protocol enabled, such as HAProxy with 'send-proxy' param:
       http://haproxy.1wt.eu/download/1.5/doc/configuration.txt */
    "tcpProxyProtocol": false,

    /* If a worker is submitting a high threshold of invalid shares we can temporarily ban their IP
       to reduce system/network load. Also useful to fight against flooding attacks. If running
       behind something like HAProxy be sure to enable 'tcpProxyProtocol', otherwise you'll end up
       banning your own IP address (and therefore all workers). */
    "banning": {
	"enabled": true,
	"time": 600, //How many seconds to ban worker for
	"invalidPercent": 50, //What percent of invalid shares triggers ban
	"checkThreshold": 500, //Check invalid percent when this many shares have been submitted
	"purgeInterval": 300 //Every this many seconds clear out the list of old bans
    },

    /* Each pool can have as many ports for your miners to connect to as you wish. Each port can
       be configured to use its own pool difficulty and variable difficulty settings. varDiff is
       optional and will only be used for the ports you configure it for. */
    "ports": {
	"4444": { //Another port for your miners to connect to, this port does not use varDiff
	    "diff": 0.0000001 //The pool difficulty
	},
	"4445": { //A port for your miners to connect to
	    "diff": 0.00000015, //the pool difficulty for this port

            /* Variable difficulty is a feature that will automatically adjust difficulty for
	       individual miners based on their hashrate in order to lower networking overhead */
	    "varDiff": {
		"minDiff": 0.00000015, //Minimum difficulty
		"maxDiff": 1, //Network difficulty will be used if it is lower than this
		"targetTime": 15, //Try to get 1 share per this many seconds
		"retargetTime": 90, //Check to see if we should retarget every this many seconds
		"variancePercent": 30 //Allow time to very this % from target without retargeting
	    }
	}
    }

}, function(ip, port , workerName, password, callback){ //stratum authorization function
    console.log("Authorize " + workerName + ":" + password + "@" + ip);
    callback({
	error: null,
	authorized: true,
	disconnect: false
    });
});



/*
{
    "job": "1",
    "ip": "::1",
    "port": 3333,
    "worker": "529692-23.0.rig",
    "difficulty": 1.5e-7,
    "shareDiff": "0.00000746",
    "blockDiff": 5.88e-7,
    "blockHash": {
	"type": "Buffer",
	"data": [0, 2, 11, 87, 237, 145, 208, 104, 151, 84, 199, 14, 158, 238, 53, 212, 112, 81, 193, 169, 60, 84, 133, 243, 192, 48, 42, 0, 132, 207, 181, 225]
    }
}

'data' object contains:
    job: 4, //stratum work job ID
    ip: '71.33.19.37', //ip address of client
    port: 3333, //port of the client
    worker: 'matt.worker1', //stratum worker name
    height: 443795, //block height
    blockReward: 5000000000, //the number of satoshis received as payment for solving this block
    difficulty: 64, //stratum worker difficulty
    shareDiff: 78, //actual difficulty of the share
    blockDiff: 3349, //block difficulty adjusted for share padding
    blockDiffActual: 3349 //actual difficulty for this block


    //AKA the block solution - set if block was found
    blockHash: '110c0447171ad819dd181216d5d80f41e9218e25d833a2789cb8ba289a52eee4',

    //Exists if "emitInvalidBlockHashes" is set to true
    blockHashInvalid: '110c0447171ad819dd181216d5d80f41e9218e25d833a2789cb8ba289a52eee4'

    //txHash is the coinbase transaction hash from the block
    txHash: '41bb22d6cc409f9c0bae2c39cecd2b3e3e1be213754f23d12c5d6d2003d59b1d,

    error: 'low share difficulty' //set if share is rejected for some reason
*/
pool.on('share', function(isValidShare, isValidBlock, data){
    console.log(data);

    if (isValidBlock)
	console.log('Block found');
    else if (isValidShare)
	console.log('Valid share submitted');
    else if (data.blockHash)
	console.log('We thought a block was found but it was rejected by the daemon');
    else
	console.log('Invalid share submitted')

    console.log('share data: ' + JSON.stringify(data));
});



/*
'severity': can be 'debug', 'warning', 'error'
'logKey':   can be 'system' or 'client' indicating if the error
            was caused by our system or a stratum client
*/
pool.on('log', function(severity, logKey, logText){
    console.log(severity + ': ' + '[' + logKey + '] ' + logText);
});


pool.start();
