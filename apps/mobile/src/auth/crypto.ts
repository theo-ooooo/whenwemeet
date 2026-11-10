// expo-crypto 를 pkce.ts 의 주입 함수 모양으로
import * as Crypto from "expo-crypto";
import type { RandomBytes, Sha256 } from "./pkce";

export const randomBytes: RandomBytes = (n) => Crypto.getRandomBytes(n);

export const sha256: Sha256 = async (input) =>
  new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, input as Uint8Array<ArrayBuffer>));
