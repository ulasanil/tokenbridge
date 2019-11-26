const Web3 = require('web3');
const log4js = require('log4js');

//configurations
const config = require('./config.js');
const logConfig = require('./log-config.json');
const abiBridge = require('./src/abis/Bridge_v0.json');
const abiMainToken = require('./src/abis/IERC20.json');
const abiSideToken = require('./src/abis/IERC20.json');
//utils
const TransactionSender = require('./src/lib/TransactionSender.js');
const Federator = require('./src/lib/Federator.js');
const utils = require('./src/lib/utils.js');

const logger = log4js.getLogger('test');
log4js.configure(logConfig);
logger.info('----------- Transfer Test ---------------------');
logger.info('Mainchain Host', config.mainchain.host);
logger.info('Sidechain Host', config.sidechain.host);

const sideConfig = {
    ...config,
    confirmations: 0,
    mainchain: config.sidechain,
    sidechain: config.mainchain,
};

const mainKeys = process.argv[2] ? process.argv[2].split(',') : [];
const sideKeys = process.argv[3] ? process.argv[3].split(',') : [];

const mainchainFederators = getMainchainFederators(mainKeys);
const sidechainFederators = getSidechainFederators(sideKeys, sideConfig);

run({ mainchainFederators, sidechainFederators, config, sideConfig });

function getMainchainFederators(keys) {
    let federators = [];
    if (keys && keys.length) {
        keys.forEach((key, i) => {
            let federator = new Federator({
                ...config,
                privateKey: key,
                storagePath: `${config.storagePath}/fed-${i + 1}`
            }, log4js.getLogger('FEDERATOR'));
            federators.push(federator);
        });
    } else {
        let federator = new Federator(config, log4js.getLogger('FEDERATOR'));
        federators.push(federator);
    }
    return federators;
}

function getSidechainFederators(keys, sideConfig) {
    let federators = [];
    if (keys && keys.length) {
        keys.forEach((key, i) => {
            let federator = new Federator({
                ...sideConfig,
                privateKey: key,
                storagePath: `${config.storagePath}/rev-fed-${i + 1}`
            },
            log4js.getLogger('FEDERATOR'));
            federators.push(federator);
        });
    } else {
        let federator = new Federator({
            ...sideConfig,
            storagePath: `${config.storagePath}/rev-fed`,
        }, log4js.getLogger('FEDERATOR'));
        federators.push(federator);
    }
    return federators;
}

async function run({ mainchainFederators, sidechainFederators, config, sideConfig }) {
    logger.info('Starting transfer from Mainchain to Sidechain');
    await transfer(mainchainFederators, sidechainFederators, config, 'MAIN', 'SIDE');
    logger.info('Completed transfer from Mainchain to Sidechain');

    logger.info('Starting transfer from Sidechain to Mainchain');
    await transfer(sidechainFederators, mainchainFederators, sideConfig, 'SIDE', 'MAIN');
    logger.info('Completed transfer from Sidechain to Mainchain');
}

async function transfer(originFederators, destinationFederators, config, origin, destination) {
    try {
        let originWeb3 = new Web3(config.mainchain.host);
        let destinationWeb3 = new Web3(config.sidechain.host);

        const originTokenContract = new originWeb3.eth.Contract(abiMainToken, config.mainchain.testToken);
        const transactionSender = new TransactionSender(originWeb3, logger);
        const destinationTransactionSender = new TransactionSender(destinationWeb3, logger);

        const originBridgeAddress = config.mainchain.bridge;
        const amount = originWeb3.utils.toWei('1');
        const originAddress = originTokenContract.options.address;

        logger.debug('Getting address from pk');
        const senderAddress = await transactionSender.getAddress(config.mainchain.privateKey);
        const receiverAddress = await destinationTransactionSender.getAddress(config.sidechain.privateKey);
        logger.info(`${origin} token addres ${originAddress} - Sender Address: ${senderAddress}`);

        logger.debug('Mapping address');
        let bridgeContract = new originWeb3.eth.Contract(abiBridge, originBridgeAddress);
        let data = bridgeContract.methods.mapAddress(receiverAddress).encodeABI();
        await transactionSender.sendTransaction(bridgeContract.options.address, data, 0, config.mainchain.privateKey);

        logger.debug('Aproving token transfer');
        data = originTokenContract.methods.approve(originBridgeAddress, amount).encodeABI();
        await transactionSender.sendTransaction(originAddress, data, 0, config.mainchain.privateKey);
        logger.debug('Token transfer approved');

        logger.debug('Bridge receiveTokens (transferFrom)');
        data = bridgeContract.methods.receiveTokens(originAddress, amount).encodeABI();
        await transactionSender.sendTransaction(originBridgeAddress, data, 0, config.mainchain.privateKey);
        logger.debug('Bridge receivedTokens completed');

        let waitBlocks = config.confirmations;
        logger.debug(`Wait for ${waitBlocks} blocks`);
        await utils.waitBlocks(originWeb3, waitBlocks);

        logger.debug('Starting federator processes');
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

        // Start origin federators with delay between them
        await originFederators.reduce(function(promise, item) {
            return promise.then(function() {
                return Promise.all([delay(5000), item.run()]);
            })
        }, Promise.resolve());

        logger.debug('Get the destination token address');
        let destinationBridgeContract = new destinationWeb3.eth.Contract(abiBridge, config.sidechain.bridge);
        let destinationTokenAddress = await destinationBridgeContract.methods.mappedTokens(originAddress).call();
        logger.info(`${destination} token address`, destinationTokenAddress);

        logger.debug('Check balance on the other side');
        let destinationTokenContract = new destinationWeb3.eth.Contract(abiSideToken, destinationTokenAddress);
        let balance = await destinationTokenContract.methods.balanceOf(receiverAddress).call();
        logger.info(`${destination} token balance`, balance);

        // Transfer back
        logger.info('Started transfer back of tokens');

        logger.debug('Getting initial balances before transfer');
        const bridgeBalanceBefore = await originTokenContract.methods.balanceOf(originBridgeAddress).call();
        const receiverBalanceBefore = await originTokenContract.methods.balanceOf(receiverAddress).call();
        const senderBalanceBefore = await originTokenContract.methods.balanceOf(senderAddress).call();

        logger.debug('Aproving token transfer on destination');
        data = destinationTokenContract.methods.approve(destinationBridgeContract.options.address, amount).encodeABI();
        await destinationTransactionSender.sendTransaction(destinationTokenContract.options.address, data, 0, config.sidechain.privateKey);
        logger.debug('Token transfer approved');

        let allowed = await destinationTokenContract.methods.allowance(receiverAddress, destinationBridgeContract.options.address).call();
        logger.debug('Allowed to transfer ', allowed);

        logger.debug('Bridge side receiveTokens');
        data = destinationBridgeContract.methods.receiveTokens(destinationTokenContract.options.address, amount).encodeABI();
        await destinationTransactionSender.sendTransaction(destinationBridgeContract.options.address, data, 0, config.sidechain.privateKey);
        logger.debug('Bridge side receiveTokens completed');

        logger.debug('Mapping address');
        data = destinationBridgeContract.methods.mapAddress(senderAddress).encodeABI();
        await destinationTransactionSender.sendTransaction(destinationBridgeContract.options.address, data, 0, config.sidechain.privateKey);

        logger.debug('Starting federator processes');
        // Start destination federators with delay between them
        await destinationFederators.reduce(function(promise, item) {
            return promise.then(function() {
                return Promise.all([delay(5000), item.run()]);
            })
        }, Promise.resolve());

        logger.debug('Getting final balances');

        const bridgeBalanceAfter = await originTokenContract.methods.balanceOf(originBridgeAddress).call();
        let expectedBalance = BigInt(bridgeBalanceBefore) - BigInt(amount);
        if (expectedBalance === BigInt(bridgeBalanceAfter)) {
            logger.debug('Bridge balance as expected: ', bridgeBalanceAfter);
        } else {
            logger.warn(`Wrong Bridge balance. Expected ${expectedBalance} but got ${bridgeBalanceAfter}`);
        }

        const receiverBalanceAfter = await originTokenContract.methods.balanceOf(receiverAddress).call();
        if (receiverBalanceBefore === receiverBalanceAfter) {
            logger.debug('Receiver balance as expected: ', receiverBalanceAfter);
        } else {
            logger.warn(`Wrong Receiver balance. Expected ${receiverBalanceBefore} but got ${receiverBalanceAfter}`);
        }

        const senderBalanceAfter = await originTokenContract.methods.balanceOf(senderAddress).call();
        expectedBalance = BigInt(senderBalanceBefore) + BigInt(amount);
        if (expectedBalance === BigInt(senderBalanceAfter)) {
            logger.debug('Sender balance as expected: ', senderBalanceAfter);
        } else {
            logger.warn(`Wrong Sender balance. Expected ${expectedBalance} but got ${senderBalanceAfter}`);
        }

    } catch(err) {
        logger.error('Unhandled Error on transfer()', err.stack);
        process.exit();
    }

}