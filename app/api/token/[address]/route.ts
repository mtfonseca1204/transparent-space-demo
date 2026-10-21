import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { publicClient } from "@/lib/viem";
import { erc20Abi } from "@/lib/uniswap-v3-abi";

export type TokenMeta = {
  address: string;
  symbol: string;
  decimals: number;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!isAddress(address)) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }

  try {
    const [symbol, decimals] = await publicClient.multicall({
      contracts: [
        { address, abi: erc20Abi, functionName: "symbol" },
        { address, abi: erc20Abi, functionName: "decimals" },
      ],
      allowFailure: false,
    });

    const data: TokenMeta = {
      address,
      symbol,
      decimals: Number(decimals),
    };

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "Failed to fetch token metadata" }, { status: 500 });
  }
}


