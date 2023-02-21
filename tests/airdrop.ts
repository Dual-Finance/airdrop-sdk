import * as anchor from '@coral-xyz/anchor';
import assert from 'assert';
import { Provider } from '@coral-xyz/anchor';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import { Airdrop } from '../src/airdrop';
import { createMint, createTokenAccount, mintToAccount } from './utils/utils';

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

    const { transaction: basicConfigTransaction, signers, airdropState } = (
      await airdrop.createConfigBasicTransaction(
        mint,
        source,
        amount,
        provider.publicKey,
      ));

    await provider.sendAndConfirm(basicConfigTransaction, signers);

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

    const { transaction: passwordConfigTransaction, signers, airdropState, verifierState } = (
      await airdrop.createConfigPasswordTransaction(
        mint,
        source,
        amount,
        provider.publicKey,
        PASSWORD
      ));

    await provider.sendAndConfirm(passwordConfigTransaction, signers);

    assert(Number((await getAccount(provider.connection, source)).amount) === 0);
    const claimAmount: anchor.BN = new anchor.BN(1_000);

    const passwordClaimTransaction: Transaction = await airdrop.createClaimPasswordTransaction(
      airdropState,
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
    const source = await createTokenAccount(provider, mint, provider.publicKey);
    await mintToAccount(provider, mint, source, amount, provider.publicKey);

    const kpOne = anchor.web3.Keypair.generate();
    const kpTwo = anchor.web3.Keypair.generate();
    const kpThree = anchor.web3.Keypair.generate();
  
    const claimAmountOne = new anchor.BN(100);
    const claimAmountTwo = new anchor.BN(101);
    const claimAmountThree = new anchor.BN(102);

    const amountsByRecipient: {account: PublicKey, amount: anchor.BN}[] = [
      { account: kpOne.publicKey, amount: claimAmountOne },
      { account: kpTwo.publicKey, amount: claimAmountTwo },
      { account: kpThree.publicKey, amount: claimAmountThree },
    ];

    const { transaction: merkleConfigTransaction, signers, airdropState, verifierState } = (
      await airdrop.createConfigMerkleTransaction(
        mint,
        source,
        amount,
        provider.publicKey,
        amountsByRecipient,
      ));

    await provider.sendAndConfirm(merkleConfigTransaction, signers, {skipPreflight: true});

    // All of the tokens are sent from the source.
    assert(Number((await getAccount(provider.connection, source)).amount) === 0);

    const recipientOneTokenAccount = await createTokenAccount(provider, mint, kpOne.publicKey);
    const merkleClaimTransaction: Transaction = await airdrop.createClaimMerkleTransaction(
      airdropState,
      verifierState,
      kpOne.publicKey,
      recipientOneTokenAccount,
      amountsByRecipient,
      provider.publicKey,
    );

    await provider.sendAndConfirm(merkleClaimTransaction);
    // Verify that the claim tokens were received.
    assert(Number((await getAccount(provider.connection, source)).amount) === claimAmountOne.toNumber());

    const merkleCloseTransaction: Transaction = (
      await airdrop.createCloseTransaction(provider.publicKey, airdropState, source)
    );
    await provider.sendAndConfirm(merkleCloseTransaction);
    // Verify that the close recovered the rest.
    assert(Number((await getAccount(provider.connection, source)).amount) === amount.toNumber());
  });
});
