import { hash, verify } from '@node-rs/argon2';

const HASH_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const TEST_OPTIONS = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

function getOptions() {
  return process.env.NODE_ENV === 'test' ? TEST_OPTIONS : HASH_OPTIONS;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, getOptions());
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password, getOptions());
}
