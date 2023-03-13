import { Connection, PublicKey } from '@solana/web3.js';

// Not include the directly package because of
// https://github.com/solana-labs/oyster/issues/538
export const GOVERNANCE_PROGRAM_SEED = 'governance';
export const GOVERNANCE_PROGRAM_ID = new PublicKey('GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw');

export class MemcmpFilter {
  offset: number;

  bytes: Buffer;

  constructor(offset: number, bytes: Buffer) {
    this.offset = offset;
    this.bytes = bytes;
  }

  isMatch(buffer: Buffer) {
    if (this.offset + this.bytes.length > buffer.length) {
      return false;
    }

    for (let i = 0; i < this.bytes.length; i++) {
      if (this.bytes[i] !== buffer[this.offset + i]) return false;
    }

    return true;
  }
}

export const pubkeyFilter = (
  offset: number,
  pubkey: PublicKey | undefined | null,
) => (!pubkey ? undefined : new MemcmpFilter(offset, pubkey.toBuffer()));

// https://github.com/solana-labs/oyster/blob/b874111120397a4ad7c3c08798577f7a8cba46d7/packages/governance-sdk/src/governance/accounts.ts#L619
export async function getTokenOwnerRecordAddress(
  programId: PublicKey,
  realm: PublicKey,
  governingTokenMint: PublicKey,
  governingTokenOwner: PublicKey,
) {
  const [tokenOwnerRecordAddress] = await PublicKey.findProgramAddress(
    [
      Buffer.from(GOVERNANCE_PROGRAM_SEED),
      realm.toBuffer(),
      governingTokenMint.toBuffer(),
      governingTokenOwner.toBuffer(),
    ],
    programId,
  );

  return tokenOwnerRecordAddress;
}

// https://github.com/solana-labs/oyster/blob/b874111120397a4ad7c3c08798577f7a8cba46d7/packages/governance-sdk/src/governance/accounts.ts#L1127
export async function getVoteRecordAddress(
  programId: PublicKey,
  proposal: PublicKey,
  tokenOwnerRecord: PublicKey,
) {
  const [voteRecordAddress] = await PublicKey.findProgramAddress(
    [Buffer.from(GOVERNANCE_PROGRAM_SEED), proposal.toBuffer(), tokenOwnerRecord.toBuffer()],
    programId,
  );

  return voteRecordAddress;
}

export async function getRealmFromGovernance(connection: Connection, governance: PublicKey) {
  const governanceData = (await connection.getAccountInfo(governance, 'single'))?.data;
  if (!governanceData) {
    return new PublicKey('');
  }
  const offset = 1;
  // https://github.com/solana-labs/oyster/blob/cb5b4e69fb95effbafdcfd429be1a598ed7a6fdd/packages/governance-sdk/src/governance/serialisation.ts#L745
  return new PublicKey(governanceData.slice(offset, offset + 32));
}

export async function getCommunityMintFromRealm(connection: Connection, realm: PublicKey) {
  const realmData = (await connection.getAccountInfo(realm, 'single'))?.data;
  if (!realmData) {
    return new PublicKey('');
  }
  const offset = 1;
  // https://github.com/solana-labs/oyster/blob/cb5b4e69fb95effbafdcfd429be1a598ed7a6fdd/packages/governance-sdk/src/governance/serialisation.ts#L703
  return new PublicKey(realmData.slice(offset, offset + 32));
}

// https://github.com/solana-labs/oyster/blob/b874111120397a4ad7c3c08798577f7a8cba46d7/packages/governance-sdk/src/governance/accounts.ts#L14
export enum GovernanceAccountType {
  Uninitialized = 0,
  RealmV1 = 1,
  TokenOwnerRecordV1 = 2,
  GovernanceV1 = 3,
  ProgramGovernanceV1 = 4,
  ProposalV1 = 5,
  SignatoryRecordV1 = 6,
  VoteRecordV1 = 7,
  ProposalInstructionV1 = 8,
  MintGovernanceV1 = 9,
  TokenGovernanceV1 = 10,
  RealmConfig = 11,
  VoteRecordV2 = 12,
  ProposalTransactionV2 = 13,
  ProposalV2 = 14,
  ProgramMetadata = 15,
  RealmV2 = 16,
  TokenOwnerRecordV2 = 17,
  GovernanceV2 = 18,
  ProgramGovernanceV2 = 19,
  MintGovernanceV2 = 20,
  TokenGovernanceV2 = 21,
  SignatoryRecordV2 = 22,
  ProposalDeposit = 23,
}
