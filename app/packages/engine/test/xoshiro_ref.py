# TC-GEN-08 の期待値を作るための、xoshiro128** の別の実装（Python）。
# 参照実装（https://prng.di.unimi.it/xoshiro128starstar.c）の式を写した。エンジンの TypeScript とは独立に書いている。
#   python xoshiro_ref.py
M = 0xFFFFFFFF


def rotl(x, k):
    return ((x << k) | (x >> (32 - k))) & M


def nxt(s):
    result = (rotl((s[1] * 5) & M, 7) * 9) & M
    t = (s[1] << 9) & M
    s[2] ^= s[0]
    s[3] ^= s[1]
    s[1] ^= s[2]
    s[0] ^= s[3]
    s[2] ^= t
    s[3] = rotl(s[3], 11)
    return result


s = [1, 2, 3, 4]
print([nxt(s) for _ in range(6)])
