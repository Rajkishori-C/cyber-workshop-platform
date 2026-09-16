#!/usr/bin/env python3
"""
SECRET VAULT AUTHORIZATION PROTOCOL
Reverse engineer this script to discover the passkey!
Run it, inspect it, or write a quick solver.
"""

VAULT_HASH = [25, 14, 28, 33, 40, 105, 44, 105, 40, 41, 105, 5, 34, 106, 40, 5, 49, 105, 35, 5, 99, 106, 104, 107, 39]

def verify_passkey(candidate: str) -> bool:
    if len(candidate) != len(VAULT_HASH):
        return False
    
    # Each character has been transformed through a bitwise operator with an unknown byte
    # Hint: Check what operator undoes XOR (Hint: XOR is its own inverse!)
    transformed = [ord(char) ^ 0x5A for char in candidate]
    return transformed == VAULT_HASH

if __name__ == "__main__":
    print("========================================")
    print("  CLASSIFIED FACILITY - ACCESS TERMINAL ")
    print("========================================")
    attempt = input("Enter Access Passkey: ").strip()
    
    if verify_passkey(attempt):
        print("\n[+] ACCESS GRANTED! Flag accepted: " + attempt)
    else:
        print("\n[-] ACCESS DENIED! Invalid passkey.")
