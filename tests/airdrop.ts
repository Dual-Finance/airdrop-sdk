import * as anchor from '@coral-xyz/anchor';
import assert from 'assert';
import { Provider } from '@coral-xyz/anchor';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { Airdrop } from '../src/airdrop';
import { createMint, createTokenAccount, mintToAccount } from './utils/utils';
import { BalanceTree } from '../src/utils/balance_tree';
import { toBytes32Array } from '../src/utils/utils';

describe('airdrop', () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider: Provider = anchor.AnchorProvider.env();
  const amount = new anchor.BN(1_000_000);

  const airdrop = new Airdrop(provider.connection.rpcEndpoint);

  it('BasicE2E', async () => {
    const mint = await createMint(provider!);
    if (provider.publicKey === undefined) { throw new Error("Testing requires 'Provider.publicKey' to be defined."); }
    if (provider.sendAndConfirm === undefined) { throw new Error("This function requires 'Provider.sendAndConfirm' to be implemented."); }
    const source = await createTokenAccount(provider, mint, provider.publicKey);
    await mintToAccount(provider, mint, source, amount, provider.publicKey);

    const { transaction: basicConfigTransaction, airdropState } = (
      await airdrop.createConfigBasicTransaction(
        source,
        amount,
        provider.publicKey,
      ));

    await provider.sendAndConfirm(basicConfigTransaction);

    assert(Number((await getAccount(provider.connection, source)).amount) === 0);
    const claimAmount: anchor.BN = new anchor.BN(1_000);

    const basicClaimTransaction: Transaction = await airdrop.createClaimBasicTransaction(
      airdropState,
      source,
      claimAmount,
      provider.publicKey,
    );

    await provider.sendAndConfirm(basicClaimTransaction);
    // Verify that the claim tokens were received.
    assert(Number((await getAccount(provider.connection, source)).amount) === claimAmount.toNumber());

    const basicCloseTransaction: Transaction = (
      await airdrop.createCloseTransaction(provider.publicKey, airdropState, source)
    );
    await provider.sendAndConfirm(basicCloseTransaction);
    // Verify that the close recovered the rest.
    assert(Number((await getAccount(provider.connection, source)).amount) === amount.toNumber());
  });

  it('PasswordE2E', async () => {
    const mint = await createMint(provider!);
    const PASSWORD = "PASSWORD";

    if (provider.publicKey === undefined) { throw new Error("Testing requires 'Provider.publicKey' to be defined."); }
    if (provider.sendAndConfirm === undefined) { throw new Error("This function requires 'Provider.sendAndConfirm' to be implemented."); }
    const source = await createTokenAccount(provider, mint, provider.publicKey);
    await mintToAccount(provider, mint, source, amount, provider.publicKey);

    const { transaction: passwordConfigTransaction, airdropState, verifierState } = (
      await airdrop.createConfigPasswordTransaction(
        source,
        amount,
        provider.publicKey,
        PASSWORD
      ));

    await provider.sendAndConfirm(passwordConfigTransaction);

    assert(Number((await getAccount(provider.connection, source)).amount) === 0);
    const claimAmount: anchor.BN = new anchor.BN(1_000);

    // Wait for propagation.
    await new Promise(f => setTimeout(f, 1_000));

    const passwordClaimTransaction: Transaction = await airdrop.createClaimPasswordTransaction(
      verifierState,
      source,
      claimAmount,
      provider.publicKey,
      PASSWORD,
    );

    await provider.sendAndConfirm(passwordClaimTransaction);
    // Verify that the claim tokens were received.
    assert(Number((await getAccount(provider.connection, source)).amount) === claimAmount.toNumber());

    const passwordCloseTransaction: Transaction = (
      await airdrop.createCloseTransaction(provider.publicKey, airdropState, source)
    );
    await provider.sendAndConfirm(passwordCloseTransaction);
    // Verify that the close recovered the rest.
    assert(Number((await getAccount(provider.connection, source)).amount) === amount.toNumber());
  });

  it('MerkleE2E', async () => {
    const mint = await createMint(provider!);

    if (provider.publicKey === undefined) { throw new Error("Testing requires 'Provider.publicKey' to be defined."); }
    if (provider.sendAndConfirm === undefined) { throw new Error("This function requires 'Provider.sendAndConfirm' to be implemented."); }
    const kpOne = anchor.web3.Keypair.generate();
    const kpTwo = anchor.web3.Keypair.generate();
    const kpThree = anchor.web3.Keypair.generate();
  
    const claimAmountOne = new anchor.BN(100);
    const claimAmountTwo = new anchor.BN(101);
    const claimAmountThree = new anchor.BN(102);

    const source = await createTokenAccount(provider, mint, provider.publicKey);
    await mintToAccount(provider, mint, source, new anchor.BN(claimAmountOne.toNumber() + claimAmountTwo.toNumber() + claimAmountThree.toNumber()), provider.publicKey);

    const amountsByRecipient: {account: PublicKey, amount: anchor.BN}[] = [
      { account: kpOne.publicKey, amount: claimAmountOne },
      { account: kpTwo.publicKey, amount: claimAmountTwo },
      { account: kpThree.publicKey, amount: claimAmountThree },
    ];

    const totalAmount = new anchor.BN(100 + 101 + 102);
    const { transaction: merkleConfigTransaction, airdropState, verifierState } = (
      await airdrop.createConfigMerkleTransaction(
        source,
        provider.publicKey,
        totalAmount,
        undefined,
        amountsByRecipient,
      ));

    await provider.sendAndConfirm(merkleConfigTransaction, [], {skipPreflight: true});

    // Wait for propagation.
    await new Promise(f => setTimeout(f, 1_000));

    // All of the tokens are sent from the source.
    assert(Number((await getAccount(provider.connection, source)).amount) === 0);

    const recipientOneTokenAccount = await getAssociatedTokenAddress(mint, kpOne.publicKey);

    // Wait for propagation.
    await new Promise(f => setTimeout(f, 1_000));

    const merkleClaimTransaction: Transaction = await airdrop.createClaimMerkleTransaction(
      verifierState,
      kpOne.publicKey,
      amountsByRecipient,
      provider.publicKey,
    );

    await provider.sendAndConfirm(merkleClaimTransaction, [], {skipPreflight: true});
    // Verify that the claim tokens were received.
    assert(Number((await getAccount(provider.connection, recipientOneTokenAccount)).amount) === claimAmountOne.toNumber());

    const merkleCloseTransaction: Transaction = (
      await airdrop.createCloseTransaction(provider.publicKey, airdropState, source)
    );
    await provider.sendAndConfirm(merkleCloseTransaction);
    // Verify that the close recovered the rest.
    // Wait for finalization.
    await new Promise(f => setTimeout(f, 1_000));
    assert(Number((await getAccount(provider.connection, source, 'single')).amount) === claimAmountTwo.toNumber() + claimAmountThree.toNumber());
  });

  it('MerkleFromRootE2E', async () => {
    const mint = await createMint(provider!);

    if (provider.publicKey === undefined) { throw new Error("Testing requires 'Provider.publicKey' to be defined."); }
    if (provider.sendAndConfirm === undefined) { throw new Error("This function requires 'Provider.sendAndConfirm' to be implemented."); }
    const kpOne = anchor.web3.Keypair.generate();
    const kpTwo = anchor.web3.Keypair.generate();
    const kpThree = anchor.web3.Keypair.generate();
  
    const claimAmountOne = new anchor.BN(100);
    const claimAmountTwo = new anchor.BN(101);
    const claimAmountThree = new anchor.BN(102);

    const source = await createTokenAccount(provider, mint, provider.publicKey);

    // Wait for propagation.
    await new Promise(f => setTimeout(f, 1_000));

    await mintToAccount(provider, mint, source, new anchor.BN(claimAmountOne.toNumber() + claimAmountTwo.toNumber() + claimAmountThree.toNumber()), provider.publicKey);

    const amountsByRecipient: {account: PublicKey, amount: anchor.BN}[] = [
      { account: kpOne.publicKey, amount: claimAmountOne },
      { account: kpTwo.publicKey, amount: claimAmountTwo },
      { account: kpThree.publicKey, amount: claimAmountThree },
    ];
    const tree = new BalanceTree(amountsByRecipient);

    const { transaction: merkleConfigTransaction, airdropState, verifierState } = (
      await airdrop.createConfigMerkleTransaction(
        source,
        provider.publicKey,
        new anchor.BN(claimAmountOne.toNumber() + claimAmountTwo.toNumber() + claimAmountThree.toNumber()),
        toBytes32Array(tree.getRoot()),
        undefined
      ));

    await provider.sendAndConfirm(merkleConfigTransaction, [], {skipPreflight: true});

    // Wait for propagation.
    await new Promise(f => setTimeout(f, 1_000));

    // All of the tokens are sent from the source.
    assert(Number((await getAccount(provider.connection, source)).amount) === 0);

    const recipientOneTokenAccount = await getAssociatedTokenAddress(mint, kpOne.publicKey);

    const merkleClaimTransaction: Transaction = await airdrop.createClaimMerkleTransaction(
      verifierState,
      kpOne.publicKey,
      amountsByRecipient,
      provider.publicKey,
    );

    await provider.sendAndConfirm(merkleClaimTransaction);
    // Verify that the claim tokens were received.
    assert(Number((await getAccount(provider.connection, recipientOneTokenAccount)).amount) === claimAmountOne.toNumber());

    const merkleCloseTransaction: Transaction = (
      await airdrop.createCloseTransaction(provider.publicKey, airdropState, source)
    );
    await provider.sendAndConfirm(merkleCloseTransaction);
    // Verify that the close recovered the rest.
    // Wait for finalization.
    await new Promise(f => setTimeout(f, 1_000));
    assert(Number((await getAccount(provider.connection, source, 'single')).amount) === claimAmountTwo.toNumber() + claimAmountThree.toNumber());
  });

  it('GovernanceE2E', async () => {
    const mint = await createMint(provider!);

    if (provider.publicKey === undefined) { throw new Error("Testing requires 'Provider.publicKey' to be defined."); }
    if (provider.sendAndConfirm === undefined) { throw new Error("This function requires 'Provider.sendAndConfirm' to be implemented."); }
    const source = await createTokenAccount(provider, mint, provider.publicKey);
    await mintToAccount(provider, mint, source, amount, provider.publicKey);

    const governance = new PublicKey('Dg31swH4qLRzqgFsDZb3eME1QvwgAXnzA1Awtwgh3oc4');

    const { transaction: governanceConfigTransaction, airdropState, verifierState } = (
      await airdrop.createConfigGovernanceTransaction(
        source,
        provider.publicKey,
        amount,
        amount,
        new anchor.BN(0),
        new anchor.BN(2_000_000_000),
        governance,
      ));

    await provider.sendAndConfirm(governanceConfigTransaction);

    assert(Number((await getAccount(provider.connection, source)).amount) === 0);

    // Wait for propagation.
    await new Promise(f => setTimeout(f, 1_000));

    const voteRecord = new PublicKey('BsGL7UwBT9ojUTMgtYh6foZrbWVnJvBBpsprdjkswVA1');
    const proposal = new PublicKey('6ws4bv5CefMwVXi54fMc6c7VU1RrT3QxYYeGzQMiVp4Z');

    const recipient = new PublicKey('2qLWeNrV7QkHQvKBoEvXrKeLqEB2ZhscZd4ds7X2JUhn');
    const recipientTokenAccount = await createTokenAccount(provider, mint, recipient);

    const governanceClaimTransaction: Transaction = await airdrop.createClaimGovernanceTransaction(
      verifierState,
      recipientTokenAccount,
      provider.publicKey,
      voteRecord,
      proposal,
    );

    await provider.sendAndConfirm(governanceClaimTransaction, [], { skipPreflight: true });

    // Wait for propagation.
    await new Promise(f => setTimeout(f, 1_000));

    // Verify that the claim tokens were received.
    assert(Number((await getAccount(provider.connection, recipientTokenAccount)).amount) === amount.toNumber());

    // Claimed all, so no need to close.
  });
});
