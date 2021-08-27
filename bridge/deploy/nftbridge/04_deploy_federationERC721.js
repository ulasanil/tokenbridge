module.exports = async function ({getNamedAccounts, deployments}) { // HardhatRuntimeEnvironment
  const {deployer, multiSig} = await getNamedAccounts()
  const {deploy, log} = deployments

  const deployResult = await deploy('Federation', {
    from: deployer,
    log: true,
  });

  if (deployResult.newlyDeployed) {
    log(`Contract Federation with set Bridge deployed at ${deployResult.address} using ${deployResult.receipt.gasUsed.toString()} gas`);
  }

  const federationDeployment = await deployments.get('Federation');
  const proxyAdminDeployment = await deployments.get('ProxyAdmin');
  const nftBridgeProxyDeployment = await deployments.get('NftBridgeProxy');
  const federationProxyDeployment = await deployments.get('FederationProxy');
  const multiSigWalletDeployment = await deployments.get('MultiSigWallet');

  const proxyAdminContract = new web3.eth.Contract(proxyAdminDeployment.abi, proxyAdminDeployment.address);
  const methodCallUpdagradeFederationDeployment = proxyAdminContract.methods.upgrade(federationProxyDeployment.address, federationDeployment.address);
  // do a call first to see if it's successful
  await methodCallUpdagradeFederationDeployment.call({ from: multiSig ?? multiSigWalletDeployment.address });

  const multiSigContract = new web3.eth.Contract(multiSigWalletDeployment.abi, multiSig ?? multiSigWalletDeployment.address);
  await multiSigContract.methods.submitTransaction(
    proxyAdminDeployment.address,
    0,
    methodCallUpdagradeFederationDeployment.encodeABI(),
  ).send({ from: deployer });
  log(`MultiSig submitTransaction upgrade FederationProxy contract in ProxyAdmin`);

  const federation = new web3.eth.Contract(federationDeployment.abi, federationProxyDeployment.address);
  const methodCallSetNftBridge = federation.methods.setNFTBridge(nftBridgeProxyDeployment.address);
  await methodCallSetNftBridge.call({ from: multiSig ?? multiSigWalletDeployment.address });
  await multiSigContract.methods.submitTransaction(federationProxyDeployment.address, 0, methodCallSetNftBridge.encodeABI())
    .send({ from: deployer });
  log(`MultiSig submitTransaction set the NFT Bridge in the Federator`);
};
module.exports.id = 'deploy_nft_federation'; // id required to prevent reexecution
module.exports.tags = ['FederationV1', 'nft', '1.0.0'];
module.exports.dependencies = ['Federation', 'ProxyAdmin', 'NftBridgeProxy', 'FederationProxy', 'MultiSigWallet'];
