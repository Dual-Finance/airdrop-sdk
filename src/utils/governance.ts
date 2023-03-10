import { Connection, PublicKey } from "@solana/web3.js";

// Not include the directly package because of
// https://github.com/solana-labs/oyster/issues/538
export const GOVERNANCE_PROGRAM_SEED = 'governance';
export const GOVERNANCE_PROGRAM_ID = new PublicKey('GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw');

// https://github.com/solana-labs/oyster/blob/b874111120397a4ad7c3c08798577f7a8cba46d7/packages/governance-sdk/src/governance/accounts.ts#L619
export async function getTokenOwnerRecordAddress(
  programId: PublicKey,
  realm: PublicKey,
  governingTokenMint: PublicKey,
  governingTokenOwner: PublicKey
) {
  const [tokenOwnerRecordAddress] = await PublicKey.findProgramAddress(
    [
      Buffer.from(GOVERNANCE_PROGRAM_SEED),
      realm.toBuffer(),
      governingTokenMint.toBuffer(),
      governingTokenOwner.toBuffer(),
    ],
    programId
  );

  return tokenOwnerRecordAddress;
}

// https://github.com/solana-labs/oyster/blob/b874111120397a4ad7c3c08798577f7a8cba46d7/packages/governance-sdk/src/governance/accounts.ts#L1127
export async function getVoteRecordAddress(programId: PublicKey, proposal: PublicKey, tokenOwnerRecord: PublicKey) {
  const [voteRecordAddress] = await PublicKey.findProgramAddress(
    [Buffer.from(GOVERNANCE_PROGRAM_SEED), proposal.toBuffer(), tokenOwnerRecord.toBuffer()],
    programId
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