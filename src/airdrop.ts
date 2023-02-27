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
  Signer,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { keccak_256 } from 'js-sha3';
import aidropIdl from './airdrop_idl.json';
import passwordVerifierIdl from './password_verifier.json';
import merkleVerifierIdl from './merkle_verifier.json';
import governanceVerifierIdl from './governance_verifier.json';
import { BalanceTree } from './utils/balance_tree';
import { toBytes32Array } from './utils/utils';

const crypto = require('crypto');

export const AIRDROP_PK: PublicKey = new PublicKey('tXmC2ARKqzPoX6wQAVmDj25XAQUN6JQe8iz19QR5Lo3');
export const BASIC_VERIFIER_PK: PublicKey = new PublicKey('FEdxZUg4BtWvMy7gy7pXEoj1isqBRYmbYdpyZfq5QZYr');
export const PASSWORD_VERIFIER_PK: PublicKey = new PublicKey('EmsREpwoUtHnmg8aSCqmTFyfp71vnnFCdZozohcrZPeL');
export const MERKLE_VERIFIER_PK: PublicKey = new PublicKey('4ibGmfZ6WU9qDc231sTRsTTHoDjQ1L6wxkrEAiEvKfLm');
export const GOVERNANCE_VERIFIER_PK: PublicKey = new PublicKey('ATCsJvzSbHaJj3a9uKTRHSoD8ZmWPfeC3sYxzcJJHTM5');
export const VERIFIER_INSTRUCTION: number[] = [133, 161, 141, 48, 120, 198, 88, 150];
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

  private passwordVerifierProgram: Program;

  private merkleVerifierProgram: Program;

  private governanceVerifierProgram: Program;

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
    this.airdropProgram = new Program(aidropIdl as Idl, AIRDROP_PK, provider);
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
    this.governanceVerifierProgram = new Program(
      governanceVerifierIdl as Idl,
      GOVERNANCE_VERIFIER_PK,
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

    const basicConfigureIx: TransactionInstruction = await this.airdropProgram.methods.configure(
      airdropSeed,
      VERIFIER_INSTRUCTION,
    )
      .accounts({
        payer: authority,
        state: airdropState,
        verifierProgram: BASIC_VERIFIER_PK,
        vault: basicVault,
        mint,
        verifierState: airdropState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    transaction.add(basicConfigureIx);

    const transferIx = createTransferInstruction(source, basicVault, authority, amount);
    transaction.add(transferIx);

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

    const { mint } = await getAccount(this.connection, source, 'single');
    const passwordVault = this.getVaultAddress(passwordAirdropState);

    const passwordConfigureIx = await this.airdropProgram.methods.configure(
      airdropSeed,
      VERIFIER_INSTRUCTION,
    )
      .accounts({
        payer: authority,
        state: passwordAirdropState,
        verifierProgram: PASSWORD_VERIFIER_PK,
        vault: passwordVault,
        mint,
        verifierState: passwordVerifierState,
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
        verificationState: passwordVerifierState,
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
  public async createConfigMerkleTransactionFromRoot(
    source: PublicKey,
    authority: PublicKey,
    totalAmount: BN,
    merkleRoot: number[],
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

    const merkleConfigureIx = await this.airdropProgram.methods.configure(
      airdropSeed,
      VERIFIER_INSTRUCTION,
    )
      .accounts({
        payer: authority,
        state: merkleAirdropState,
        verifierProgram: MERKLE_VERIFIER_PK,
        vault: merkleVault,
        mint,
        verifierState: merkleVerifierState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    // First instruction configures the airdrop program.
    transaction.add(merkleConfigureIx);

    const merkleInitIx = await this.merkleVerifierProgram.methods.init(
      verifierSeed,
      merkleRoot,
    )
      .accounts({
        payer: authority,
        state: merkleVerifierState,
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
   * Create a transaction with the instructions for setting up a merkle airdrop.
   * This includes the config as well as transferring the tokens.
   */
  public async createConfigMerkleTransaction(
    source: PublicKey,
    authority: PublicKey,
    amountsByRecipient: {account: PublicKey, amount: BN}[],
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

    const merkleConfigureIx = await this.airdropProgram.methods.configure(
      airdropSeed,
      VERIFIER_INSTRUCTION,
    )
      .accounts({
        payer: authority,
        state: merkleAirdropState,
        verifierProgram: MERKLE_VERIFIER_PK,
        vault: merkleVault,
        mint,
        verifierState: merkleVerifierState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    // First instruction configures the airdrop program.
    transaction.add(merkleConfigureIx);

    const tree = new BalanceTree(amountsByRecipient);
    const merkleInitIx = await this.merkleVerifierProgram.methods.init(
      verifierSeed,
      toBytes32Array(tree.getRoot()),
    )
      .accounts({
        payer: authority,
        state: merkleVerifierState,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    // Next instruction configures the merkle tree.
    transaction.add(merkleInitIx);

    // Finally transfer tokens into the vault.
    const totalAmount = amountsByRecipient.reduce(
      (sum, current) => sum + current.amount.toNumber(),
      0,
    );
    const transferIx = createTransferInstruction(source, merkleVault, authority, totalAmount);
    transaction.add(transferIx);

    return {
      transaction,
      airdropState: merkleAirdropState,
      verifierState: merkleVerifierState,
    };
  }

  /**
   * Create a transaction with the instructions for setting up a governance
   * airdrop. This includes the config as well as transferring the tokens.
   */
  public async createConfigGovernanceTransaction(
    source: PublicKey,
    amountPerVoter: BN,
    totalAmount: BN,
    authority: PublicKey,
    eligibilityStart: BN,
    eligibilityEnd: BN,
    governance: PublicKey,
  ): Promise<AirdropConfigureContext> {
    const transaction: Transaction = new Transaction();

    const { mint } = await getAccount(this.connection, source, 'single');

    const airdropSeed = crypto.randomBytes(32);
    const verifierSeed = crypto.randomBytes(32);
    const [governanceAirdropState, _governanceAirdropStateBump] = (
      web3.PublicKey.findProgramAddressSync(
        [airdropSeed],
        this.airdropProgram.programId,
      ));
    const [governanceVerifierState, _governanceVerifierBump] = (
      web3.PublicKey.findProgramAddressSync(
        [verifierSeed],
        this.governanceVerifierProgram.programId,
      ));

    const governanceVault = this.getVaultAddress(governanceAirdropState);

    const governanceConfigureIx = await this.airdropProgram.methods.configure(
      airdropSeed,
      VERIFIER_INSTRUCTION,
    )
      .accounts({
        payer: authority,
        state: governanceAirdropState,
        verifierProgram: GOVERNANCE_VERIFIER_PK,
        vault: governanceVault,
        mint,
        verifierState: governanceVerifierState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    // First instruction configures the airdrop program.
    transaction.add(governanceConfigureIx);

    const governanceInitIx = await this.governanceVerifierProgram.methods
      .configure(verifierSeed, amountPerVoter, eligibilityStart, eligibilityEnd)
      .accounts({
        payer: authority,
        state: governanceVerifierState,
        governance,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    // Next instruction configures the governance state.
    transaction.add(governanceInitIx);

    // Finally transfer tokens into the vault.
    const transferIx = createTransferInstruction(source, governanceVault, authority, totalAmount);
    transaction.add(transferIx);

    return {
      transaction,
      airdropState: governanceAirdropState,
      verifierState: governanceVerifierState,
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

    const vault = this.getVaultAddress(airdropState);
    const basicClaimIx: TransactionInstruction = await this.airdropProgram.methods.claim(
      amount,
      // This is the data for the proof. In this case, no verification is done, so no proof.
      Buffer.from(''),
    )
      .accounts({
        authority,
        state: airdropState,
        vault,
        recipient: recipientTokenAccount,
        verifierProgram: BASIC_VERIFIER_PK,
        // The verifier doesnt actually verifiy, so in this case, none is
        // needed, so any public key will do.
        verifierState: airdropState,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).instruction();

    transaction.add(basicClaimIx);

    return transaction;
  }

  /**
   * Create a transaction with the instructions for setting up a password claim.
   */
  public async createClaimPasswordTransaction(
    airdropState: PublicKey,
    recipient: PublicKey,
    amount: BN,
    authority: PublicKey,
    password: string,
  ): Promise<web3.Transaction> {
    const airdropStateObj = await this.airdropProgram.account.state.fetch(airdropState, 'single');
    const { verifierState } = airdropStateObj;

    const transaction: Transaction = new Transaction();

    const vault = this.getVaultAddress(airdropState);
    const passwordClaimIx: TransactionInstruction = await this.airdropProgram.methods.claim(
      amount,
      // This is the data for the proof.
      Buffer.from(password),
    )
      .accounts({
        authority,
        state: airdropState,
        vault,
        recipient,
        verifierProgram: PASSWORD_VERIFIER_PK,
        verifierState,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).instruction();

    transaction.add(passwordClaimIx);

    return transaction;
  }

  /**
   * Create a transaction with the instructions for setting up a merkle claim.
   */
  public async createClaimMerkleTransaction(
    airdropState: PublicKey,
    recipient: PublicKey,
    amountsByRecipient: {account: PublicKey, amount: BN}[],
    authority: PublicKey,
  ): Promise<web3.Transaction> {
    const airdropStateObj = await this.airdropProgram.account.state.fetch(airdropState, 'single');
    const { verifierState } = airdropStateObj;

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

    const merkleClaimIx: TransactionInstruction = await this.airdropProgram.methods.claim(
      amount,
      verificationData,
    )
      .accounts({
        authority,
        state: airdropState,
        vault,
        recipient: recipientTokenAccount,
        verifierProgram: MERKLE_VERIFIER_PK,
        verifierState,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        {
          pubkey: receipt,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: web3.SystemProgram.programId,
          isWritable: false,
          isSigner: false,
        },
      ])
      .instruction();

    transaction.add(merkleClaimIx);

    return transaction;
  }

  /**
   * Create a transaction with the instructions for setting up a governance claim.
   */
  public async createClaimGovernanceTransaction(
    airdropState: PublicKey,
    recipient: PublicKey,
    amount: BN,
    voteRecord: PublicKey,
    governance: PublicKey,
    proposal: PublicKey,
    authority: PublicKey,
  ): Promise<web3.Transaction> {
    const airdropStateObj = await this.airdropProgram.account.state.fetch(airdropState, 'single');
    const { verifierState } = airdropStateObj;

    const transaction: Transaction = new Transaction();

    // TODO: Lookup the governance, voteRecord, and proposal for the user.
    // Governance is on the state
    // Search through all the proposals and all the voteRecords for one that matches

    const vault = this.getVaultAddress(airdropState);

    const [receipt, _receiptBump] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(utils.bytes.utf8.encode('Receipt')),
        verifierState.toBuffer(),
        voteRecord.toBuffer(),
      ],
      GOVERNANCE_VERIFIER_PK,
    );

    const governanceClaimIx = await this.airdropProgram.methods.claim(
      amount,
      Buffer.alloc(0),
    )
      .accounts({
        authority,
        state: airdropState,
        vault,
        recipient,
        verifierProgram: GOVERNANCE_VERIFIER_PK,
        verifierState,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        {
          pubkey: governance,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: proposal,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: voteRecord,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: receipt,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: web3.SystemProgram.programId,
          isWritable: false,
          isSigner: false,
        },
      ]).instruction();

    transaction.add(governanceClaimIx);

    return transaction;
  }

  // TODO: Send to clockwork
}
