import { Provider, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

const anchor = require('@coral-xyz/anchor');
const { TokenInstructions } = require('@project-serum/serum');

const DEFAULT_MINT_DECIMALS = 6;

async function createMintInstructions(
  provider: Provider,
  authority: PublicKey,
  mint: PublicKey,
) {
  const instructions = [
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: provider.publicKey,
      newAccountPubkey: mint,
      space: 82,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
      programId: TokenInstructions.TOKEN_PROGRAM_ID,
    }),
    TokenInstructions.initializeMint({
      mint,
      decimals: DEFAULT_MINT_DECIMALS,
      mintAuthority: authority,
    }),
  ];
  return instructions;
}

export async function createMint(
  provider: Provider,
) {
  const authority = provider.publicKey;
  const mint = anchor.web3.Keypair.generate();
  const instructions = await createMintInstructions(
    provider,
    // @ts-ignore
    authority,
    mint.publicKey,
  );

  const tx = new anchor.web3.Transaction();
  tx.add(...instructions);

  // @ts-ignore
  await provider.sendAndConfirm(tx, [mint]);

  return mint.publicKey;
}

async function createMintToAccountInstrs(
  mint: PublicKey,
  destination: PublicKey,
  amount: BN,
  mintAuthority: PublicKey,
) {
  return [
    TokenInstructions.mintTo({
      mint,
      destination,
      amount,
      mintAuthority,
    }),
  ];
}

export async function mintToAccount(
  provider: Provider,
  mint: PublicKey,
  destination: PublicKey,
  amount: BN,
  mintAuthority: PublicKey,
) {
  const tx = new anchor.web3.Transaction();
  tx.add(
    ...(await createMintToAccountInstrs(
      mint,
      destination,
      amount,
      mintAuthority,
    )),
  );
  // @ts-ignore
  await provider.sendAndConfirm(tx);
}

async function createTokenAccountInstrs(
  provider: Provider,
  newAccountPubkey: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
) {
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(165);
  return [
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: provider.publicKey,
      newAccountPubkey,
      space: 165,
      lamports,
      programId: TokenInstructions.TOKEN_PROGRAM_ID,
    }),
    TokenInstructions.initializeAccount({
      account: newAccountPubkey,
      mint,
      owner,
    }),
  ];
}

export async function createTokenAccount(
  provider: Provider,
  mint: PublicKey,
  owner: PublicKey,
) {
  const vault = anchor.web3.Keypair.generate();
  const tx = new anchor.web3.Transaction();
  tx.add(
    ...(await createTokenAccountInstrs(
      provider,
      vault.publicKey,
      mint,
      owner,
    )),
  );
  // @ts-ignore
  await provider.sendAndConfirm(tx, [vault]);
  return vault.publicKey;
}

export const toBytes32Array = (b: Buffer): number[] => {
  const buf = Buffer.alloc(32);
  b.copy(buf, 32 - b.length);

  return Array.from(buf);
};
