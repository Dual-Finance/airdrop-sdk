import {
  AnchorProvider, Idl, Program, Wallet, web3, utils, BN,
} from '@coral-xyz/anchor';
import { createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
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
import aidropIdl from './airdrop.json';
import passwordVerifierIdl from './password_verifier.json';
import merkleVerifierIdl from './merkle_verifier.json';
import governanceVerifierIdl from './governance_verifier.json';
import { BalanceTree } from './utils/balance_tree';
import { toBytes32Array } from './utils/utils';

export const AIRDROP_PK: PublicKey = new PublicKey('tXmC2ARKqzPoX6wQAVmDj25XAQUN6JQe8iz19QR5Lo3');
export const BASIC_VERIFIER_PK: PublicKey = new PublicKey('FEdxZUg4BtWvMy7gy7pXEoj1isqBRYmbYdpyZfq5QZYr');
export const PASSWORD_VERIFIER_PK: PublicKey = new PublicKey('EmsREpwoUtHnmg8aSCqmTFyfp71vnnFCdZozohcrZPeL');
export const MERKLE_VERIFIER_PK: PublicKey = new PublicKey('4ibGmfZ6WU9qDc231sTRsTTHoDjQ1L6wxkrEAiEvKfLm');
export const GOVERNANCE_VERIFIER_PK: PublicKey = new PublicKey('ATCsJvzSbHaJj3a9uKTRHSoD8ZmWPfeC3sYxzcJJHTM5');
export const VERIFIER_INSTRUCTION: number[] = [133, 161, 141, 48, 120, 198, 88, 150];

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
    mint: PublicKey,
    source: PublicKey,
    amount: BN,
    authority: PublicKey,
  ): Promise<web3.Transaction> {
    const transaction: Transaction = new Transaction();

    const airdropState = web3.Keypair.generate();
    const basicVerifierState = web3.Keypair.generate();
    const basicVault = this.getVaultAddress(airdropState.publicKey);

    const basicConfigureIx: TransactionInstruction = await this.airdropProgram.methods.configure(
      VERIFIER_INSTRUCTION,
    )
      .accounts({
        payer: authority,
        state: airdropState.publicKey,
        verifierProgram: BASIC_VERIFIER_PK,
        vault: basicVault,
        mint,
        verifierState: basicVerifierState.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([basicVerifierState]).instruction();

    transaction.add(basicConfigureIx);

    const transferIx = createTransferInstruction(source, basicVault, authority, amount);
    transaction.add(transferIx);

    return transaction;
  }

  /**
   * Create a transaction with the instructions for setting up a password airdrop.
   * This includes the config as well as transferring the tokens.
   */
  public async createConfigPasswordTransaction(
    mint: PublicKey,
    source: PublicKey,
    amount: BN,
    authority: PublicKey,
    password: string,
  ): Promise<web3.Transaction> {
    const transaction: Transaction = new Transaction();

    const passwordState = web3.Keypair.generate();
    const passwordVerifierState = web3.Keypair.generate();
    const passwordVault = this.getVaultAddress(passwordState.publicKey);

    const passwordConfigureIx = await this.airdropProgram.methods.configure(
      VERIFIER_INSTRUCTION,
    )
      .accounts({
        payer: authority,
        state: passwordState.publicKey,
        verifierProgram: PASSWORD_VERIFIER_PK,
        vault: passwordVault,
        mint,
        verifierState: passwordVerifierState.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([passwordState])
      .instruction();

    // First instruction configures the airdrop program.
    transaction.add(passwordConfigureIx);

    const passwordInitIx = await this.passwordVerifierProgram.methods.init(
      Buffer.from(keccak_256.digest(Buffer.from(password))),
    )
      .accounts({
        authority,
        verificationState: passwordVerifierState.publicKey,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([passwordVerifierState])
      .instruction();

    // Next instruction configures the password.
    transaction.add(passwordInitIx);

    // Finally transfer tokens into the vault.
    const transferIx = createTransferInstruction(source, passwordVault, authority, amount);
    transaction.add(transferIx);

    return transaction;
  }

  /**
   * Create a transaction with the instructions for setting up a merkle airdrop.
   * This includes the config as well as transferring the tokens.
   */
  public async createConfigMerkleTransaction(
    mint: PublicKey,
    source: PublicKey,
    totalAmount: BN,
    authority: PublicKey,
    amountsByRecipient: [{account: PublicKey, amount: BN}],
  ): Promise<web3.Transaction> {
    const transaction: Transaction = new Transaction();

    const merkleState = web3.Keypair.generate();
    const merkleVerifierState = web3.Keypair.generate();
    const merkleVault = this.getVaultAddress(merkleState.publicKey);

    const merkleConfigureIx = await this.airdropProgram.methods.configure(
      VERIFIER_INSTRUCTION,
    )
      .accounts({
        payer: authority,
        state: merkleState.publicKey,
        verifierProgram: MERKLE_VERIFIER_PK,
        vault: merkleVault,
        mint,
        verifierState: merkleVerifierState.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([merkleState])
      .instruction();

    // First instruction configures the airdrop program.
    transaction.add(merkleConfigureIx);

    const tree = new BalanceTree(amountsByRecipient);
    const merkleInitIx = await this.merkleVerifierProgram.methods.init(
      toBytes32Array(tree.getRoot()),
    )
      .accounts({
        authority,
        verificationState: merkleVerifierState.publicKey,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([merkleVerifierState])
      .instruction();

    // Next instruction configures the merkle tree.
    transaction.add(merkleInitIx);

    // Finally transfer tokens into the vault.
    const transferIx = createTransferInstruction(source, merkleVault, authority, totalAmount);
    transaction.add(transferIx);

    return transaction;
  }

  /**
   * Create a transaction with the instructions for setting up a governance
   * airdrop. This includes the config as well as transferring the tokens.
   */
  public async createConfigGovernanceTransaction(
    mint: PublicKey,
    source: PublicKey,
    totalAmount: BN,
    authority: PublicKey,
    eligibilityStart: BN,
    eligibilityEnd: BN,
    governance: PublicKey,
  ): Promise<web3.Transaction> {
    const transaction: Transaction = new Transaction();

    const governanceState = web3.Keypair.generate();
    const governanceVerifierState = web3.Keypair.generate();
    const governanceVault = this.getVaultAddress(governanceState.publicKey);

    const governanceConfigureIx = await this.airdropProgram.methods.configure(
      VERIFIER_INSTRUCTION,
    )
      .accounts({
        payer: authority,
        state: governanceState.publicKey,
        verifierProgram: GOVERNANCE_VERIFIER_PK,
        vault: governanceVault,
        mint,
        verifierState: governanceVerifierState.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([governanceState])
      .instruction();

    // First instruction configures the airdrop program.
    transaction.add(governanceConfigureIx);

    const governanceInitIx = await this.governanceVerifierProgram.methods
      .configure(totalAmount, eligibilityStart, eligibilityEnd)
      .accounts({
        payer: authority,
        state: governanceState.publicKey,
        governance,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([governanceState])
      .instruction();

    // Next instruction configures the governance state.
    transaction.add(governanceInitIx);

    // Finally transfer tokens into the vault.
    const transferIx = createTransferInstruction(source, governanceVault, authority, totalAmount);
    transaction.add(transferIx);

    return transaction;
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
    recipient: PublicKey,
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
        recipient,
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
    verifierState: PublicKey,
  ): Promise<web3.Transaction> {
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
    recipientTokenAccount: PublicKey,
    amountsByRecipient: [{account: PublicKey, amount: BN}],
    authority: PublicKey,
    verifierState: PublicKey,
  ): Promise<web3.Transaction> {
    const transaction: Transaction = new Transaction();
    const vault = this.getVaultAddress(airdropState);
    const tree = new BalanceTree(amountsByRecipient);

    const index = amountsByRecipient.findIndex((element) => element.account === recipient);
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
    verifierState: PublicKey,
  ): Promise<web3.Transaction> {
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
