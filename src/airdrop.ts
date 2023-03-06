import {
  AnchorProvider, Idl, Program, Wallet, web3, utils, BN,
} from '@coral-xyz/anchor';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Commitment,
  ConfirmOptions,
  Connection,
  ConnectionConfig,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { keccak_256 } from 'js-sha3';
import solAirdropIdl from './sol_airdrop.json';
import basicVerifierIdl from './basic_verifier.json';
import passwordVerifierIdl from './password_verifier.json';
import merkleVerifierIdl from './merkle_verifier.json';
import { BalanceTree } from './utils/balance_tree';
import { toBytes32Array } from './utils/utils';

const crypto = require('crypto');

export const AIRDROP_PK: PublicKey = new PublicKey('tXmC2ARKqzPoX6wQAVmDj25XAQUN6JQe8iz19QR5Lo3');
export const BASIC_VERIFIER_PK: PublicKey = new PublicKey('FEdxZUg4BtWvMy7gy7pXEoj1isqBRYmbYdpyZfq5QZYr');
export const PASSWORD_VERIFIER_PK: PublicKey = new PublicKey('EmsREpwoUtHnmg8aSCqmTFyfp71vnnFCdZozohcrZPeL');
export const MERKLE_VERIFIER_PK: PublicKey = new PublicKey('4ibGmfZ6WU9qDc231sTRsTTHoDjQ1L6wxkrEAiEvKfLm');
export type AirdropConfigureContext = {
  transaction: web3.Transaction,
  airdropState: PublicKey,
  verifierState: PublicKey
};

/**
 * API class with functions to interact with the Airdrop Program
 */
export class Airdrop {
  private connection: Connection;

  private airdropProgram: Program;

  private basicVerifierProgram: Program;

  private passwordVerifierProgram: Program;

  private merkleVerifierProgram: Program;

  private commitment: Commitment | ConnectionConfig | undefined;

  /**
   * Create an Airdrop object
   *
   * @param rpcUrl The solana cluster endpoint used for the connecton
   */
  constructor(rpcUrl: string, commitment: Commitment | string = 'finalized') {
    this.commitment = commitment as Commitment;
    this.connection = new Connection(
      rpcUrl,
      (this.commitment as Commitment) || 'finalized',
    );

    const opts: ConfirmOptions = {
      preflightCommitment: 'finalized',
      commitment: 'finalized',
    };

    // Public key and payer not actually needed since this does not send transactions.
    const wallet: Wallet = {
      publicKey: AIRDROP_PK,
      signAllTransactions: async (txs) => txs,
      signTransaction: async (tx) => tx,
      payer: new Keypair(),
    };

    const provider = new AnchorProvider(this.connection, wallet, opts);
    this.airdropProgram = new Program(solAirdropIdl as Idl, AIRDROP_PK, provider);
    this.basicVerifierProgram = new Program(
      basicVerifierIdl as Idl,
      BASIC_VERIFIER_PK,
      provider,
    );
    this.passwordVerifierProgram = new Program(
      passwordVerifierIdl as Idl,
      PASSWORD_VERIFIER_PK,
      provider,
    );
    this.merkleVerifierProgram = new Program(
      merkleVerifierIdl as Idl,
      MERKLE_VERIFIER_PK,
      provider,
    );
  }

  getVaultAddress(state: PublicKey) {
    const [vault, _bump] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(utils.bytes.utf8.encode('Vault')),
        state.toBuffer(),
      ],
      this.airdropProgram.programId,
    );
    return vault;
  }

  /**
   * Create a transaction with the instructions for setting up a basic airdrop.
   * This includes the config as well as transferring the tokens.
   */
  public async createConfigBasicTransaction(
    source: PublicKey,
    amount: BN,
    authority: PublicKey,
  ): Promise<AirdropConfigureContext> {
    const transaction: Transaction = new Transaction();

    const airdropSeed = crypto.randomBytes(32);
    const [airdropState, _airdropStateBump] = (
      web3.PublicKey.findProgramAddressSync(
        [airdropSeed],
        this.airdropProgram.programId,
      ));
    const basicVault = this.getVaultAddress(airdropState);
    const { mint } = await getAccount(this.connection, source, 'single');

    const [verifierSignature, _signatureBump] = web3.PublicKey.findProgramAddressSync(
      [airdropState.toBuffer()],
      this.basicVerifierProgram.programId,
    );

    const basicConfigureIx: TransactionInstruction = await this.airdropProgram.methods.configure(
      airdropSeed,
    )
      .accounts({
        payer: authority,
        verifierSignature,
        vault: basicVault,
        mint,
        state: airdropState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    transaction.add(basicConfigureIx);

    const transferIx = createTransferInstruction(source, basicVault, authority, amount);
    transaction.add(transferIx);

    // No verifier state is actually needed.
    return {
      transaction,
      airdropState,
      verifierState: airdropState,
    };
  }

  /**
   * Create a transaction with the instructions for setting up a password airdrop.
   * This includes the config as well as transferring the tokens.
   */
  public async createConfigPasswordTransaction(
    source: PublicKey,
    amount: BN,
    authority: PublicKey,
    password: string,
  ): Promise<AirdropConfigureContext> {
    const transaction: Transaction = new Transaction();

    const airdropSeed = crypto.randomBytes(32);
    const verifierSeed = crypto.randomBytes(32);
    const [passwordAirdropState, _passwordAirdropStateBump] = (
      web3.PublicKey.findProgramAddressSync(
        [airdropSeed],
        this.airdropProgram.programId,
      ));
    const [passwordVerifierState, _passwordVerifierBump] = (
      web3.PublicKey.findProgramAddressSync(
        [verifierSeed],
        this.passwordVerifierProgram.programId,
      ));

    const [verifierSignature, _signatureBump] = web3.PublicKey.findProgramAddressSync(
      [passwordAirdropState.toBuffer()],
      this.passwordVerifierProgram.programId,
    );

    const { mint } = await getAccount(this.connection, source, 'single');
    const passwordVault = this.getVaultAddress(passwordAirdropState);

    const passwordConfigureIx = await this.airdropProgram.methods.configure(
      airdropSeed,
    )
      .accounts({
        payer: authority,
        state: passwordAirdropState,
        vault: passwordVault,
        mint,
        verifierSignature,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    // First instruction configures the airdrop program.
    transaction.add(passwordConfigureIx);

    const passwordInitIx = await this.passwordVerifierProgram.methods.init(
      verifierSeed,
      Buffer.from(keccak_256.digest(Buffer.from(password))),
    )
      .accounts({
        authority,
        verifierState: passwordVerifierState,
        airdropState: passwordAirdropState,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    // Next instruction configures the password.
    transaction.add(passwordInitIx);

    // Finally transfer tokens into the vault.
    const transferIx = createTransferInstruction(source, passwordVault, authority, amount);
    transaction.add(transferIx);

    return {
      transaction,
      airdropState: passwordAirdropState,
      verifierState: passwordVerifierState,
    };
  }

  /**
   * Create a transaction with the instructions for setting up a merkle airdrop.
   * This includes the config as well as transferring the tokens.
   */
  public async createConfigMerkleTransaction(
    source: PublicKey,
    authority: PublicKey,
    totalAmount: BN,
    merkleRoot?: number[],
    amountsByRecipient?: {account: PublicKey, amount: BN}[],
  ): Promise<AirdropConfigureContext> {
    const transaction: Transaction = new Transaction();

    const { mint } = await getAccount(this.connection, source, 'single');

    const airdropSeed = crypto.randomBytes(32);
    const verifierSeed = crypto.randomBytes(32);
    const [merkleAirdropState, _merkleAirdropStateBump] = (
      web3.PublicKey.findProgramAddressSync(
        [airdropSeed],
        this.airdropProgram.programId,
      ));
    const [merkleVerifierState, _merkleVerifierBump] = (
      web3.PublicKey.findProgramAddressSync(
        [verifierSeed],
        this.merkleVerifierProgram.programId,
      ));
    const merkleVault = this.getVaultAddress(merkleAirdropState);
    const [verifierSignature, _signatureBump] = web3.PublicKey.findProgramAddressSync(
      [merkleAirdropState.toBuffer()],
      this.merkleVerifierProgram.programId,
    );

    const merkleConfigureIx = await this.airdropProgram.methods.configure(
      airdropSeed,
    )
      .accounts({
        payer: authority,
        verifierSignature,
        vault: merkleVault,
        mint,
        state: merkleAirdropState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    // First instruction configures the airdrop program.
    transaction.add(merkleConfigureIx);

    let root: number[] = [];
    if (amountsByRecipient) {
      const tree = new BalanceTree(amountsByRecipient);
      root = toBytes32Array(tree.getRoot());
    } else if (merkleRoot) {
      root = merkleRoot;
    } else {
      throw new Error('Merkle root of amounts by recipient required');
    }

    const merkleInitIx = await this.merkleVerifierProgram.methods.init(
      verifierSeed,
      root,
    )
      .accounts({
        payer: authority,
        state: merkleVerifierState,
        airdropState: merkleAirdropState,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    // Next instruction configures the merkle tree.
    transaction.add(merkleInitIx);

    const transferIx = createTransferInstruction(source, merkleVault, authority, totalAmount);
    transaction.add(transferIx);

    return {
      transaction,
      airdropState: merkleAirdropState,
      verifierState: merkleVerifierState,
    };
  }

  /**
   * Create a transaction for recovering airdrop tokens that were not claimed.
   */
  public async createCloseTransaction(
    authority: PublicKey,
    state: PublicKey,
    recipient: PublicKey,
  ): Promise<web3.Transaction> {
    const transaction: Transaction = new Transaction();
    const vault = this.getVaultAddress(state);
    const closeIx = await this.airdropProgram.methods.close()
      .accounts({
        authority,
        state,
        vault,
        recipient,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).instruction();
    transaction.add(closeIx);
    return transaction;
  }

  /**
   * Create a transaction with the instructions for setting up a basic claim.
   */
  public async createClaimBasicTransaction(
    airdropState: PublicKey,
    recipientTokenAccount: PublicKey,
    amount: BN,
    authority: PublicKey,
  ): Promise<web3.Transaction> {
    const transaction: Transaction = new Transaction();

    const [verifierSignature, _signatureBump] = web3.PublicKey.findProgramAddressSync(
      [airdropState.toBuffer()],
      this.basicVerifierProgram.programId,
    );

    const vault = this.getVaultAddress(airdropState);
    const basicClaimIx: TransactionInstruction = await this.basicVerifierProgram.methods.claim(
      amount,
    )
      .accounts({
        authority,
        airdropState,
        cpiAuthority: verifierSignature,
        vault,
        recipient: recipientTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        airdropProgram: this.airdropProgram.programId,
      }).instruction();

    transaction.add(basicClaimIx);

    return transaction;
  }

  /**
   * Create a transaction with the instructions for setting up a password claim.
   */
  public async createClaimPasswordTransaction(
    verifierState: PublicKey,
    recipient: PublicKey,
    amount: BN,
    authority: PublicKey,
    password: string,
  ): Promise<web3.Transaction> {
    const verifierStateObj = await this.passwordVerifierProgram.account.verifierState.fetch(verifierState, 'single');
    const { airdropState } = verifierStateObj;

    const transaction: Transaction = new Transaction();

    const [verifierSignature, _signatureBump] = web3.PublicKey.findProgramAddressSync(
      [airdropState.toBuffer()],
      this.passwordVerifierProgram.programId,
    );

    const vault = this.getVaultAddress(airdropState);
    const passwordClaimIx: TransactionInstruction = (
      await this.passwordVerifierProgram.methods.claim(
        amount,
        // This is the data for the proof.
        Buffer.from(password),
      )
        .accounts({
          authority,
          verifierState,
          cpiAuthority: verifierSignature,
          airdropState,
          vault,
          recipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          airdropProgram: this.airdropProgram.programId,
        }).instruction());

    transaction.add(passwordClaimIx);

    return transaction;
  }

  /**
   * Create a transaction with the instructions for setting up a merkle claim.
   */
  public async createClaimMerkleTransaction(
    verifierState: PublicKey,
    recipient: PublicKey,
    amountsByRecipient: {account: PublicKey, amount: BN}[],
    authority: PublicKey,
  ): Promise<web3.Transaction> {
    const verifierStateObj = await this.merkleVerifierProgram.account.verifierState.fetch(verifierState, 'single');
    const { airdropState } = verifierStateObj;

    const airdropStateObj = await this.airdropProgram.account.state.fetch(airdropState, 'single');

    const vaultObj = await getAccount(this.connection, airdropStateObj.vault, 'single');
    const { mint } = vaultObj;
    const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);

    const transaction: Transaction = new Transaction();

    // Possibly initialize the recipient token account.
    if (!(await this.connection.getAccountInfo(recipientTokenAccount, 'single'))) {
      transaction.add(createAssociatedTokenAccountInstruction(
        authority,
        recipientTokenAccount,
        recipient,
        mint,
      ));
    }

    const vault = this.getVaultAddress(airdropState);
    const tree = new BalanceTree(amountsByRecipient);

    const index = amountsByRecipient.findIndex(
      (element) => element.account.toBase58() === recipient.toBase58(),
    );
    const { amount } = amountsByRecipient[index];

    const proofStrings: Buffer[] = tree.getProof(index, recipient, amount);
    const proofBytes: number[][] = proofStrings.map((p) => toBytes32Array(p));

    let verificationData: Buffer = Buffer.allocUnsafe(8);
    verificationData.writeBigUInt64LE(BigInt(index));

    // Calculate the receipt here because the verification data conveniently is
    // a buffer with just index.
    const [receipt, _receiptBump] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(utils.bytes.utf8.encode('Receipt')),
        verifierState.toBuffer(),
        verificationData,
      ],
      MERKLE_VERIFIER_PK,
    );

    for (const proofElem of proofBytes) {
      verificationData = Buffer.concat([verificationData, Buffer.from(proofElem)]);
    }

    const [verifierSignature, _signatureBump] = web3.PublicKey.findProgramAddressSync(
      [airdropState.toBuffer()],
      this.merkleVerifierProgram.programId,
    );

    const merkleClaimIx: TransactionInstruction = await this.merkleVerifierProgram.methods.claim(
      amount,
      verificationData,
    )
      .accounts({
        authority,
        verifierState,
        cpiAuthority: verifierSignature,
        airdropState,
        vault,
        recipient: recipientTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        receipt,
        airdropProgram: this.airdropProgram.programId,
      })
      .instruction();

    transaction.add(merkleClaimIx);

    return transaction;
  }

  // TODO: Handle proof of voting
  // TODO: Send to clockwork
}
