var events = require('events');
var async = require('async');
var net = require('net');

var varDiff = require('./varDiff.js');
var stratum = require('./stratum.js');
var jobManager = require('./jobManager.js');
var util = require('./util.js');

/*process.on('uncaughtException', function(err) {
  console.log(err.stack);
  throw err;
  });*/

var pool = module.exports = function pool(options, authorizeFn){

    this.options = options;

    options.initStats = {}

    var _this = this;

    var emitLog        = function(text) { _this.emit('log', 'debug'  , text); };
    var emitWarningLog = function(text) { _this.emit('log', 'warning', text); };
    var emitErrorLog   = function(text) { _this.emit('log', 'error'  , text); };
    var emitSpecialLog = function(text) { _this.emit('log', 'special', text); };


    this.start = function(){
        SetupVarDiff();
        SetupApi();
        SetupDaemon(function(){
            SetupJobManager();
	    GetFirstJob(function(){
		StartStratumServer(function(){
		    OutputPoolInfo();
		    _this.emit('started');
		});
	    });
        });
    };

    function SetupDaemon(finishedCallback){

	// isolate and use logging!
	
	host="127.0.0.1";
	port=4109;

	_this.client = new net.Socket();
	_this.client.on("data", (data) => {
	    let json;
	    try {
		if(data[data.length-1] == 0) {
		    json = JSON.parse(data.slice(0, data.length-1));
		} else {
		    json = JSON.parse(data);
		}
		if(json.hasOwnProperty("method") && json.method == "miner-notify") {
		    _this.jobManager.processTemplate(json.params[0]);
		} else if(json.hasOwnProperty("result") && json.result instanceof Object) {
		    console.log("Block accepted at height " + json.result.block + " with payload " + json.result.payload);
		} else if(json.hasOwnProperty("error") && json.error !== null) {
		    console.log("[ERROR] " + json.error);
		} else {
		    console.log("[UNKNOWN ERROR] " + data);
		}
	    } catch(error) {
		console.log("[UNKNOWN ERROR] " + data);
	    }
	});

	_this.client.on("close", () => {
	    console.log("Connection closed");
	});

	_this.client.connect(port, host, () => {
	    console.log("Connected");
	    finishedCallback();
	});

	_this.client.on("error", (err) => {
	    console.log("Connection error: " + err);
	});
	
    }
    
    function GetFirstJob(finishedCallback){
	setTimeout(function () {

	    finishedCallback();

	}, 1000);
    }
    
    function OutputPoolInfo(){

        var startMessage = 'PascalCoin Pool Started';
        if (process.env.forkId && process.env.forkId !== '0'){
            emitLog(startMessage);
            return;
        }
	/*
        var infoLines = [startMessage,
			 'Network Connected:\t' + (options.testnet ? 'Testnet' : 'Mainnet'),
			 'Detected Reward Type:\t' + options.coin.reward,
			 'Current Block Height:\t' + _this.jobManager.currentJob.rpcData.height,
			 'Current Connect Peers:\t' + options.initStats.connections,
			 'Current Block Diff:\t' + _this.jobManager.currentJob.difficulty * algos[options.coin.algorithm].multiplier,
			 'Network Difficulty:\t' + options.initStats.difficulty,
			 'Network Hash Rate:\t' + util.getReadableHashRateString(options.initStats.networkHashRate),
			 'Stratum Port(s):\t' + _this.options.initStats.stratumPorts.join(', '),
			 'Pool Fee Percent:\t' + _this.options.feePercent + '%'
			 ];
	*/
	var infoLines = [startMessage];

        emitSpecialLog(infoLines.join('\n\t\t\t\t\t\t'));
    }



    function SetupApi() {
        if (typeof(options.api) !== 'object' || typeof(options.api.start) !== 'function') {
            return;
        } else {
            options.api.start(_this);
        }
    }



    function SetupVarDiff(){
        _this.varDiff = {};
        Object.keys(options.ports).forEach(function(port) {
            if (options.ports[port].varDiff)
                _this.setVarDiff(port, options.ports[port].varDiff);
        });
    }


    /*
      Submit Block to Daemon
    */
    function SubmitBlock(block, callback){

	var data = {"id":block.height, "method":"miner-submit","params":[block]};

	_this.client.write(JSON.stringify(data)+'\n');
	
	emitLog('Submitted Block at height ' + block.height + ' successfully to daemon');
	
	callback();
    }


    function SetupJobManager(){

        _this.jobManager = new jobManager(options);

        _this.jobManager.on('newBlock', function(blockTemplate){
            //Check if stratumServer has been initialized yet
            if (_this.stratumServer) {
                _this.stratumServer.broadcastMiningJobs(blockTemplate.getJobParams());
            }
        }).on('updatedBlock', function(blockTemplate){
            //Check if stratumServer has been initialized yet
            if (_this.stratumServer) {
                var job = blockTemplate.getJobParams();
                job[8] = false;
                _this.stratumServer.broadcastMiningJobs(job);
            }
        }).on('share', function(shareData, block){
	    
            var isValidShare = !shareData.error;
            var isValidBlock = !!block;
            var emitShare = function(){
                _this.emit('share', isValidShare, isValidBlock, shareData);
            };

            /*
              If we calculated that the block solution was found,
              before we emit the share, lets submit the block
            */

            if(!isValidBlock) {
                emitShare();
	    } else {
                SubmitBlock(block, function(){
                    emitShare();
                });
            }
        }).on('log', function(severity, message){
            _this.emit('log', severity, message);
        });
    }



    function StartStratumServer(finishedCallback){
        _this.stratumServer = new stratum.Server(options, authorizeFn);

        _this.stratumServer.on('started', function(){
            options.initStats.stratumPorts = Object.keys(options.ports);
            _this.stratumServer.broadcastMiningJobs(_this.jobManager.currentJob.getJobParams());
            finishedCallback();

        }).on('broadcastTimeout', function(){
	    emitLog('No new blocks for ' + options.jobRebroadcastTimeout + ' seconds - updating transactions & rebroadcasting work');
	    _this.jobManager.updateCurrentJob();

	}).on('client.connected', function(client){
            if (typeof(_this.varDiff[client.socket.localPort]) !== 'undefined') {
                _this.varDiff[client.socket.localPort].manageClient(client);
            }

            client.on('difficultyChanged', function(diff){
                _this.emit('difficultyUpdate', client.workerName, diff);

            }).on('subscription', function(params, resultCallback){

                var extraNonce = _this.jobManager.extraNonceCounter.next();
                var extraNonce2Size = _this.jobManager.extraNonce2Size;
                resultCallback(null,
			       extraNonce,
			       extraNonce2Size
			      );

                if (typeof(options.ports[client.socket.localPort]) !== 'undefined' && options.ports[client.socket.localPort].diff) {
                    this.sendDifficulty(options.ports[client.socket.localPort].diff);
                } else {
                    this.sendDifficulty(0.00001); // fallback diff
                }

                this.sendMiningJob(_this.jobManager.currentJob.getJobParams());

            }).on('submit', function(params, resultCallback){
                var result =_this.jobManager.processShare(
                    params.jobId,
                    client.previousDifficulty,
                    client.difficulty,
                    client.extraNonce1,
                    params.extraNonce2,
                    params.nTime,
                    params.nonce,
                    client.remoteAddress,
                    client.socket.localPort,
                    params.name
                );

                resultCallback(result.error, result.result ? true : null);

            }).on('malformedMessage', function (message) {
                emitWarningLog('Malformed message from ' + client.getLabel() + ': ' + message);

            }).on('socketError', function(err) {
                emitWarningLog('Socket error from ' + client.getLabel() + ': ' + JSON.stringify(err));

            }).on('socketTimeout', function(reason){
                emitWarningLog('Connected timed out for ' + client.getLabel() + ': ' + reason)

            }).on('socketDisconnect', function() {
                //emitLog('Socket disconnected from ' + client.getLabel());

            }).on('kickedBannedIP', function(remainingBanTime){
                emitLog('Rejected incoming connection from ' + client.remoteAddress + ' banned for ' + remainingBanTime + ' more seconds');

            }).on('forgaveBannedIP', function(){
                emitLog('Forgave banned IP ' + client.remoteAddress);

            }).on('unknownStratumMethod', function(fullMessage) {
                emitLog('Unknown stratum method from ' + client.getLabel() + ': ' + fullMessage.method);

            }).on('socketFlooded', function() {
                emitWarningLog('Detected socket flooding from ' + client.getLabel());

            }).on('tcpProxyError', function(data) {
                emitErrorLog('Client IP detection failed, tcpProxyProtocol is enabled yet did not receive proxy protocol message, instead got data: ' + data);

            }).on('bootedBannedWorker', function(){
                emitWarningLog('Booted worker ' + client.getLabel() + ' who was connected from an IP address that was just banned');

            }).on('triggerBan', function(reason){
                emitWarningLog('Banned triggered for ' + client.getLabel() + ': ' + reason);
                _this.emit('banIP', client.remoteAddress, client.workerName);
            });
        });
    }




    function CheckBlockAccepted(blockHash, callback){
        //setTimeout(function(){
        _this.daemon.cmd('getblock',
			 [blockHash],
			 function(results){
			     var validResults = results.filter(function(result){
				 return result.response && (result.response.hash === blockHash)
			     });

			     if (validResults.length >= 1){
				 callback(true, validResults[0].response.tx[0]);
			     }
			     else{
				 callback(false);
			     }
			 }
			);
        //}, 500);
    }



    this.relinquishMiners = function(filterFn, resultCback) {
        var origStratumClients = this.stratumServer.getStratumClients();

        var stratumClients = [];
        Object.keys(origStratumClients).forEach(function (subId) {
            stratumClients.push({subId: subId, client: origStratumClients[subId]});
        });
        async.filter(
            stratumClients,
            filterFn,
            function (clientsToRelinquish) {
                clientsToRelinquish.forEach(function(cObj) {
                    cObj.client.removeAllListeners();
                    _this.stratumServer.removeStratumClientBySubId(cObj.subId);
                });

                process.nextTick(function () {
                    resultCback(
                        clientsToRelinquish.map(
                            function (item) {
                                return item.client;
                            }
                        )
                    );
                });
            }
        )
    };


    this.attachMiners = function(miners) {
        miners.forEach(function (clientObj) {
            _this.stratumServer.manuallyAddStratumClient(clientObj);
        });
        _this.stratumServer.broadcastMiningJobs(_this.jobManager.currentJob.getJobParams());

    };


    this.getStratumServer = function() {
        return _this.stratumServer;
    };


    this.setVarDiff = function(port, varDiffConfig) {
        if (typeof(_this.varDiff[port]) != 'undefined' ) {
            _this.varDiff[port].removeAllListeners();
        }
        var varDiffInstance = new varDiff(port, varDiffConfig);
        _this.varDiff[port] = varDiffInstance;
        _this.varDiff[port].on('newDifficulty', function(client, newDiff) {

            /* We request to set the newDiff @ the next difficulty retarget
               (which should happen when a new job comes in - AKA BLOCK) */
            client.enqueueNextDifficulty(newDiff);

            /*if (options.varDiff.mode === 'fast'){
            //Send new difficulty, then force miner to use new diff by resending the
            //current job parameters but with the "clean jobs" flag set to false
            //so the miner doesn't restart work and submit duplicate shares
            client.sendDifficulty(newDiff);
            var job = _this.jobManager.currentJob.getJobParams();
            job[8] = false;
            client.sendMiningJob(job);
            }*/

        });
    };

};
pool.prototype.__proto__ = events.EventEmitter.prototype;
