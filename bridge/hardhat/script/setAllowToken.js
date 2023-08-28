// How to run the script: npx hardhat run ./hardhat/script/setAllowToken.js --network bsctestnet
const hre = require("hardhat");

async function main() {
  const {getNamedAccounts, deployments} = hre;
  const {deployer} = await getNamedAccounts();

  const tokenToList = '0x00.....';
  const tokenToListType = '0';
  const AllowTokens = await deployments.get('AllowTokens');
  const AllowTokensProxy = await deployments.get('AllowTokensProxy');
  const MultiSigWallet = await deployments.get('MultiSigWallet');

  const allowTokens = new web3.eth.Contract(AllowTokens.abi, AllowTokensProxy.address);
  const multiSigContract = new web3.eth.Contract(MultiSigWallet.abi, MultiSigWallet.address);

  console.log("\nAllowTokensV1.sol", AllowTokens.address);
  console.log("\nAllowTokensProxy", AllowTokensProxy.address);
  console.log("\nMultiSigWallet", MultiSigWallet.address);

  const methodCallSetToken = allowTokens.methods.setToken(tokenToList, tokenToListType);
  const result = await methodCallSetToken.call({ from: MultiSigWallet.address});
  console.log("Method call result", result);

  const receipt = await multiSigContract.methods.submitTransaction(
    AllowTokensProxy.address,
    0,
    methodCallSetToken.encodeABI()
  ).send({
    from: deployer,
    gasLimit: 3000000
  });
  console.log("Transaction worked", receipt.transactionHash);

  console.log("finish");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
