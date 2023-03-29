# airdrop-sdk

Airdrop is a public utility on Solana for distributing tokens without requiring
going through a hot wallet. Without this tool, a project would have to give the
tokens to a wallet that can sign all the distributions and trust them. This tool
stores the tokens in a program owned account and recipients are able to submit
claims to get their tokens.

Users of this program need to decide how they will run the airdrop. This program
holds and distributes the tokens as instructed by a verifier. There are a few
sample verifiers, (basic, password, merkle proof, governance), or you can create
your own.
