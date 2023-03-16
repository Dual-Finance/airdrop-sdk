import { PublicKey } from '@solana/web3.js';
import {
  BinaryReader, Schema, BorshError, BinaryWriter,
} from 'borsh';

(BinaryReader.prototype as any).readPubkey = function () {
  const reader = this as unknown as BinaryReader;
  const array = reader.readFixedArray(32);
  return new PublicKey(array);
};

(BinaryWriter.prototype as any).writePubkey = function (value: PublicKey) {
  const writer = this as unknown as BinaryWriter;
  writer.writeFixedArray(value.toBuffer());
};

export enum VoteTypeKind {
  SingleChoice = 0,
  MultiChoice = 1,
}

export class VoteType {
  type: VoteTypeKind;

  choiceCount: number | undefined;

  constructor(args: { type: VoteTypeKind; choiceCount: number | undefined }) {
    this.type = args.type;
    this.choiceCount = args.choiceCount;
  }

  static SINGLE_CHOICE = new VoteType({
    type: VoteTypeKind.SingleChoice,
    choiceCount: undefined,
  });

  static MULTI_CHOICE = (choiceCount: number) => new VoteType({
    type: VoteTypeKind.MultiChoice,
    choiceCount,
  });

  isSingleChoice() {
    return this.type === VoteTypeKind.SingleChoice;
  }
}

(BinaryReader.prototype as any).readVoteType = function () {
  const reader = this as unknown as BinaryReader;
  const value = reader.buf.readUInt8(reader.offset);
  reader.offset += 1;

  if (value === VoteTypeKind.SingleChoice) {
    return VoteType.SINGLE_CHOICE;
  }

  const choiceCount = reader.buf.readUInt16LE(reader.offset);
  return VoteType.MULTI_CHOICE(choiceCount);
};

export enum VoteThresholdType {
  // Approval Quorum
  YesVotePercentage = 0,
  // Not supported in the current version
  QuorumPercentage = 1,
  // Supported for VERSION >= 3
  Disabled = 2,
}

export class VoteThreshold {
  type: VoteThresholdType;

  value: number | undefined;

  constructor(args: { type: VoteThresholdType; value?: number | undefined }) {
    this.type = args.type;
    this.value = args.value;
  }
}

(BinaryReader.prototype as any).readVoteThreshold = function () {
  const reader = this as unknown as BinaryReader;

  // Read VoteThreshold and advance the reader by 1
  const type = reader.buf.readUInt8(reader.offset);
  reader.offset += 1;

  // Read VoteThresholds with u8 value
  if (
    type === VoteThresholdType.YesVotePercentage
    || type === VoteThresholdType.QuorumPercentage
  ) {
    const percentage = reader.buf.readUInt8(reader.offset);
    reader.offset += 1;
    return new VoteThreshold({ type, value: percentage });
  }

  // Read VoteThresholds without value
  if (type === VoteThresholdType.Disabled) {
    return new VoteThreshold({ type, value: undefined });
  }

  throw new Error(`VoteThresholdType ${type} is not supported`);
};

function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function deserializeField(
  schema: Schema,
  fieldName: string,
  fieldType: any,
  reader: BinaryReader,
): any {
  try {
    if (typeof fieldType === 'string') {
      return (reader as any)[`read${capitalizeFirstLetter(fieldType)}`]();
    }

    if (fieldType instanceof Array) {
      if (typeof fieldType[0] === 'number') {
        return reader.readFixedArray(fieldType[0]);
      }

      return reader.readArray(() => deserializeField(schema, fieldName, fieldType[0], reader));
    }

    if (fieldType.kind === 'option') {
      const option = reader.readU8();
      if (option) {
        return deserializeField(schema, fieldName, fieldType.type, reader);
      }

      return undefined;
    }

    return deserializeStruct(schema, fieldType, reader);
  } catch (error) {
    if (error instanceof BorshError) {
      error.addToFieldPath(fieldName);
    }
    throw error;
  }
}

function deserializeStruct(
  schema: Schema,
  classType: any,
  reader: BinaryReader,
) {
  const structSchema = schema.get(classType);

  if (structSchema.kind === 'struct') {
    const result: any = {};
    for (const [fieldName, fieldType] of schema.get(classType).fields) {
      result[fieldName] = deserializeField(
        schema,
        fieldName,
        fieldType,
        reader,
      );
    }
    return result;
  }

  throw new BorshError(`Unexpected schema kind: ${structSchema.kind}`);
}

/// Deserializes object from bytes using schema.
export function deserializeBorsh(
  schema: Schema,
  classType: any,
  buffer: Buffer,
): any {
  const reader = new BinaryReader(buffer);
  return deserializeStruct(schema, classType, reader);
}

export const ACCOUNT_VERSION_V1 = 1;
export const ACCOUNT_VERSION_V2 = 2;

export class Proposal {}
export class ProposalOption {}

export function createGovernanceAccountSchema(accountVersion: number) {
  return new Map<Function, any>([
    [
      ProposalOption,
      {
        kind: 'struct',
        fields: [
          ['label', 'string'],
          ['voteWeight', 'u64'],
          ['voteResult', 'u8'],
          ['instructionsExecutedCount', 'u16'],
          ['instructionsCount', 'u16'],
          ['instructionsNextIndex', 'u16'],
        ],
      },
    ],
    [
      Proposal,
      {
        kind: 'struct',
        fields: [
          ['accountType', 'u8'],
          ['governance', 'pubkey'],
          ['governingTokenMint', 'pubkey'],
          ['state', 'u8'],
          ['tokenOwnerRecord', 'pubkey'],
          ['signatoriesCount', 'u8'],
          ['signatoriesSignedOffCount', 'u8'],

          ...(accountVersion === ACCOUNT_VERSION_V1
            ? [
              ['yesVotesCount', 'u64'],
              ['noVotesCount', 'u64'],
              ['instructionsExecutedCount', 'u16'],
              ['instructionsCount', 'u16'],
              ['instructionsNextIndex', 'u16'],
            ]
            : [
              ['voteType', 'voteType'],
              ['options', [ProposalOption]],
              ['denyVoteWeight', { kind: 'option', type: 'u64' }],
              ['reserved1', 'u8'],
              ['abstainVoteWeight', { kind: 'option', type: 'u64' }],
              ['startVotingAt', { kind: 'option', type: 'u64' }],
            ]),

          ['draftAt', 'u64'],
          ['signingOffAt', { kind: 'option', type: 'u64' }],
          ['votingAt', { kind: 'option', type: 'u64' }],
          ['votingAtSlot', { kind: 'option', type: 'u64' }],
          ['votingCompletedAt', { kind: 'option', type: 'u64' }],
          ['executingAt', { kind: 'option', type: 'u64' }],
          ['closedAt', { kind: 'option', type: 'u64' }],
          ['executionFlags', 'u8'],
          ['maxVoteWeight', { kind: 'option', type: 'u64' }],

          ...(accountVersion === ACCOUNT_VERSION_V1
            ? []
            : [['maxVotingTime', { kind: 'option', type: 'u32' }]]),

          ['voteThreshold', { kind: 'option', type: 'VoteThreshold' }],

          ...(accountVersion === ACCOUNT_VERSION_V1
            ? []
            : [['reserved', [64]]]),

          ['name', 'string'],
          ['descriptionLink', 'string'],

          ...(accountVersion === ACCOUNT_VERSION_V1
            ? []
            : [['vetoVoteWeight', 'u64']]),
        ],
      },
    ],
  ]);
}
