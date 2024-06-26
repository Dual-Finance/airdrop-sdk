import crypto from 'crypto';
import {
  AnchorProvider, Idl, Program, Wallet, web3, utils, BN,
} from '@coral-xyz/anchor';
import {
  Account,
  createAssociatedTokenAccountIdempotentInstruction,
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
import bs58 from 'bs58';
import { keccak_256 } from 'js-sha3';
import dualAirdropIdl from './dual_airdrop.json';
import basicVerifierIdl from './basic_verifier.json';
import passwordVerifierIdl from './password_verifier.json';
import merkleVerifierIdl from './merkle_verifier.json';
import governanceVerifierIdl from './governance_verifier.json';
import orcaVerifierIdl from './orca_verifier.json';
import { BalanceTree } from './utils/balance_tree';
import { toBytes32Array } from './utils/utils';
import {
  getCommunityMintFromRealm,
  getRealmFromGovernance,
  getTokenOwnerRecordAddress,
  getVoteRecordAddress,
  GovernanceAccountType,
  GOVERNANCE_PROGRAM_ID,
  pubkeyFilter,
} from './utils/governance';
import {
  ACCOUNT_VERSION_V2, createGovernanceAccountSchema, deserializeBorsh, Proposal,
} from './utils/deserialize';

export const AIRDROP_PK: PublicKey = new PublicKey('2fJcpdR6qzqDP7fBqvoJQ5PGYdaRFBNyUKZkZf5t12mr');
export const BASIC_VERIFIER_PK: PublicKey = new PublicKey('FEdxZUg4BtWvMy7gy7pXEoj1isqBRYmbYdpyZfq5QZYr');
export const PASSWORD_VERIFIER_PK: PublicKey = new PublicKey('EmsREpwoUtHnmg8aSCqmTFyfp71vnnFCdZozohcrZPeL');
export const MERKLE_VERIFIER_PK: PublicKey = new PublicKey('8tBcmZAMNm11DuGAS2r6PqSA3CKt72amoz8bVj14xRiT');
export const GOVERNANCE_VERIFIER_PK: PublicKey = new PublicKey('ATCsJvzSbHaJj3a9uKTRHSoD8ZmWPfeC3sYxzcJJHTM5');
export const ORCA_VERIFIER_PK: PublicKey = new PublicKey('9X1uDdEsKpc7s1WdZzmfzLG5nhnf2KuE5WpaDaGjGyiG');
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
  private governanceVerifierProgram: Program;
  private orcaVerifierProgram: Program;
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
    this.airdropProgram = new Program(dualAirdropIdl as Idl, AIRDROP_PK, provider);
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
    this.governanceVerifierProgram = new Program(
      governanceVerifierIdl as Idl,
      GOVERNANCE_VERIFIER_PK,
      provider,
    );
    this.orcaVerifierProgram = new Program(
      orcaVerifierIdl as Idl,
      ORCA_VERIFIER_PK,
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

  async fetchOrcaVerifierState(verifierState: PublicKey) {
    const verifierStateObj = await this.orcaVerifierProgram.account.verifierState.fetch(
      verifierState,
    );
    return verifierStateObj;
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
        closeAuthority: authority,
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
        closeAuthority: authority,
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
    closeAuthority?: PublicKey,
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
      [merkleVerifierState.toBuffer()],
      this.merkleVerifierProgram.programId,
    );

    const merkleConfigureIx = await this.airdropProgram.methods.configure(
      airdropSeed,
    )
      .accounts({
        payer: authority,
        closeAuthority: closeAuthority ?? authority,
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
   * Create a transaction with the instructions for setting up a governance
   * airdrop. This includes the config as well as transferring the tokens.
   */
  public async createConfigGovernanceTransaction(
    source: PublicKey,
    authority: PublicKey,
    totalAmount: BN,
    amountPerVoter: BN,
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
    const [verifierSignature, _signatureBump] = web3.PublicKey.findProgramAddressSync(
      [governanceAirdropState.toBuffer()],
      this.governanceVerifierProgram.programId,
    );

    const governanceConfigureIx = await this.airdropProgram.methods.configure(
      airdropSeed,
    )
      .accounts({
        payer: authority,
        closeAuthority: authority,
        verifierSignature,
        vault: governanceVault,
        mint,
        state: governanceAirdropState,
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
        airdropState: governanceAirdropState,
        governance,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    // Next instruction configures the governance verifier.
    transaction.add(governanceInitIx);

    const transferIx = createTransferInstruction(source, governanceVault, authority, totalAmount);
    transaction.add(transferIx);

    return {
      transaction,
      airdropState: governanceAirdropState,
      verifierState: governanceVerifierState,
    };
  }

  /**
   * Create a transaction with the instructions for setting up an orca
   * airdrop. This includes the config as well as transferring the tokens.
   */
  public async createConfigOrcaTransaction(
    source: PublicKey,
    authority: PublicKey,
    totalAmount: BN,
    pool: PublicKey,
    rewardIndex: number,
  ): Promise<AirdropConfigureContext> {
    const transaction: Transaction = new Transaction();

    const { mint } = await getAccount(this.connection, source);

    const airdropSeed = crypto.randomBytes(32);
    const verifierSeed = crypto.randomBytes(32);
    const [orcaAirdropState, _orcaAirdropStateBump] = (
      web3.PublicKey.findProgramAddressSync(
        [airdropSeed],
        this.airdropProgram.programId,
      ));
    const [orcaVerifierState, _orcaVerifierBump] = (
      web3.PublicKey.findProgramAddressSync(
        [verifierSeed],
        this.orcaVerifierProgram.programId,
      ));
    const vault = this.getVaultAddress(orcaAirdropState);
    const [verifierSignature, _signatureBump] = web3.PublicKey.findProgramAddressSync(
      [orcaAirdropState.toBuffer()],
      this.orcaVerifierProgram.programId,
    );

    const orcaConfigureIx = await this.airdropProgram.methods.configure(
      airdropSeed,
    )
      .accounts({
        payer: authority,
        verifierSignature,
        vault,
        mint,
        state: orcaAirdropState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    // First instruction configures the airdrop program.
    transaction.add(orcaConfigureIx);

    const orcaInitIx = await this.orcaVerifierProgram.methods
      .init(verifierSeed, rewardIndex)
      .accounts({
        authority,
        state: orcaVerifierState,
        airdropState: orcaAirdropState,
        pool,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    // Next instruction configures the orca verifier.
    transaction.add(orcaInitIx);

    const transferIx = createTransferInstruction(source, vault, authority, totalAmount);
    transaction.add(transferIx);

    return {
      transaction,
      airdropState: orcaAirdropState,
      verifierState: orcaVerifierState,
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
      [verifierState.toBuffer()],
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

  /**
   * Create a transaction with the instructions for setting up a governance claim.
   */
  public async createClaimGovernanceTransaction(
    verifierState: PublicKey,
    recipient: PublicKey,
    authority: PublicKey,
  ): Promise<web3.Transaction> {
    const verifierStateObj = await this.governanceVerifierProgram.account.verifierState.fetch(verifierState, 'single');
    const {
      airdropState, governance, eligibilityStart, eligibilityEnd,
    } = verifierStateObj;

    const transaction: Transaction = new Transaction();

    const airdropStateObj = await this.airdropProgram.account.state.fetch(airdropState, 'single');

    const vaultObj = await getAccount(this.connection, airdropStateObj.vault, 'single');
    const { mint } = vaultObj;
    const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);

    // Possibly initialize the recipient token account.
    if (!(await this.connection.getAccountInfo(recipientTokenAccount, 'single'))) {
      transaction.add(createAssociatedTokenAccountInstruction(
        authority,
        recipientTokenAccount,
        recipient,
        mint,
      ));
    }
    const realm = await getRealmFromGovernance(this.connection, governance);
    const communityMint = await getCommunityMintFromRealm(this.connection, realm);

    const tokenOwnerRecordAddress = await getTokenOwnerRecordAddress(
      GOVERNANCE_PROGRAM_ID,
      realm,
      communityMint,
      recipient,
    );

    const proposalFilters = [
      pubkeyFilter(1, governance)!,
      pubkeyFilter(33, communityMint)!,
    ];
    const proposals = await this.connection.getProgramAccounts(GOVERNANCE_PROGRAM_ID, {
      commitment: this.connection.commitment,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: bs58.encode([GovernanceAccountType.ProposalV2]),
          },
        },
        ...proposalFilters.map((f) => ({
          memcmp: { offset: f.offset, bytes: bs58.encode(f.bytes) },
        })),
      ],
    });

    let proposal: PublicKey | undefined;
    for (const possibleProposal of proposals) {
      const possibleVoteRecord = await getVoteRecordAddress(
        GOVERNANCE_PROGRAM_ID,
        possibleProposal.pubkey,
        tokenOwnerRecordAddress,
      );

      // Check if it is in the range
      const deserializedProposal = deserializeBorsh(
        createGovernanceAccountSchema(ACCOUNT_VERSION_V2),
        Proposal,
        possibleProposal.account.data,
      );
      const { votingAt } = deserializedProposal;

      if (eligibilityEnd.toNumber() < votingAt.toNumber()
          || eligibilityStart.toNumber() > votingAt.toNumber()) {
        continue;
      }

      // TODO: Check if it already has a receipt

      if ((await this.connection.getAccountInfo(possibleVoteRecord, 'single'))) {
        // If the voteRecord exists, use that.
        proposal = possibleProposal.pubkey;
        break;
      }

      // Sleep 100ms to backoff load on the RPC.
      await new Promise((r) => setTimeout(r, 10));
    }

    if (proposal === undefined) {
      throw new Error('Could not find VoteRecord');
    }

    const voteRecord = await getVoteRecordAddress(
      GOVERNANCE_PROGRAM_ID,
      proposal,
      tokenOwnerRecordAddress,
    );

    const [receipt, _receiptBump] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(utils.bytes.utf8.encode('Receipt')),
        verifierState.toBuffer(),
        voteRecord.toBuffer(),
      ],
      GOVERNANCE_VERIFIER_PK,
    );

    const [verifierSignature, _signatureBump] = web3.PublicKey.findProgramAddressSync(
      [airdropState.toBuffer()],
      this.governanceVerifierProgram.programId,
    );

    const vault = this.getVaultAddress(airdropState);
    const governanceClaimIx: TransactionInstruction = (
      await this.governanceVerifierProgram.methods.claim()
        .accounts({
          authority,
          verifierState,
          recipient: recipientTokenAccount,
          governance,
          proposal,
          voteRecord,
          receipt,
          cpiAuthority: verifierSignature,
          airdropState,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          airdropProgram: this.airdropProgram.programId,
          systemProgram: web3.SystemProgram.programId,
        }).instruction());

    transaction.add(governanceClaimIx);

    return transaction;
  }

  /**
   * Create a transaction with the instructions for setting up an orca claim.
   */
  public async createClaimOrcaTransaction(
    verifierState: PublicKey,
    recipient: PublicKey,
    position: PublicKey,
    positionTokenAccount: PublicKey,
    authority: PublicKey,
  ): Promise<web3.Transaction> {
    const verifierStateObj = await this.orcaVerifierProgram.account.verifierState.fetch(
      verifierState,
    );
    const { airdropState } = verifierStateObj;

    const transaction: Transaction = new Transaction();

    const airdropStateObj = await this.airdropProgram.account.state.fetch(airdropState);

    const vaultObj: Account = await getAccount(this.connection, airdropStateObj.vault);
    const { mint } = vaultObj;
    const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);
    transaction.add(createAssociatedTokenAccountIdempotentInstruction(
      authority,
      recipientTokenAccount,
      recipient,
      mint,
    ));

    const [receipt, _receiptBump] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(utils.bytes.utf8.encode('Receipt')),
        verifierState.toBuffer(),
        position.toBuffer(),
      ],
      ORCA_VERIFIER_PK,
    );
    // Init receipt if needed
    if (!await this.connection.getAccountInfo(receipt)) {
      const initReceiptIx = await this.orcaVerifierProgram.methods.initReceipt()
        .accounts({
          authority,
          verifierState,
          position,
          receipt,
          systemProgram: web3.SystemProgram.programId,
        }).instruction();
      transaction.add(initReceiptIx);
    }

    const [verifierSignature, _signatureBump] = web3.PublicKey.findProgramAddressSync(
      [airdropState.toBuffer()],
      this.orcaVerifierProgram.programId,
    );

    const vault = this.getVaultAddress(airdropState);
    const orcaClaimIx: TransactionInstruction = (
      await this.orcaVerifierProgram.methods.claim()
        .accounts({
          authority,
          verifierState,
          recipient: recipientTokenAccount,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          airdropProgram: this.airdropProgram.programId,
          position,
          positionTokenAccount,
          receipt,
          cpiAuthority: verifierSignature,
          airdropState,
        }).instruction());

    transaction.add(orcaClaimIx);

    return transaction;
  }

  // TODO: Send to clockwork
}
