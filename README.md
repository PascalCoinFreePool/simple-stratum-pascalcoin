# simple-stratum-pascalcoin

This is NOT a PascalCoin pool. For the full pool, please see [this repo](https://github.com/PascalCoinFreePool/PascalCoinFreePool).

This code allows you to set up a very simple stratum server for PascalCoin. It will not keep track of shares, payouts, blocks found, etc. It will only connect to the PascalCoin daemon (by default testnet) and send work to connected miners.

This repo is only to be used by developers, and is most likely is missing features that are present in the full pool code.

Forked from: https://github.com/zone117x/node-stratum-pool
