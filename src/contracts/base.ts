import {
  Client,
  ICallData,
  IContractReadOperationResponse,
  IReadData,
  MAX_GAS_CALL,
  MassaUnits,
  strToBytes
} from '@massalabs/massa-web3'

class EventDecoder {
  static decodeError = (bytes: string): string => {
    const errorSplit = bytes.split('error: ')
    return errorSplit[errorSplit.length - 1].split(' at')[0].split('"')[0]
  }
}

type BaseCallData = Omit<ICallData, 'fee' | 'maxGas' | 'targetAddress'>

export class IBaseContract {
  constructor(
    public address: string,
    protected client: Client,
    protected fee: bigint = MassaUnits.oneMassa / 100n
  ) {}

  public async call(
    params: BaseCallData & {
      maxGas?: bigint
    },
    estimateCoins = true,
    estimateGas = true
  ): Promise<string> {
    const coinsNeeded = estimateCoins
      ? await this.estimateCoins(params)
      : params.coins
    const gasNeeded = estimateGas
      ? await this.estimateGas({ ...params, coins: coinsNeeded })
      : params.maxGas
    return this.client.smartContracts().callSmartContract({
      ...params,
      targetAddress: this.address,
      maxGas: gasNeeded,
      coins: coinsNeeded,
      fee: this.fee
    })
  }

  public async read(
    params: Omit<IReadData, 'maxGas' | 'targetAddress'> & {
      maxGas?: bigint
    }
  ): Promise<IContractReadOperationResponse> {
    return this.client.smartContracts().readSmartContract({
      ...params,
      targetAddress: this.address,
      maxGas: params.maxGas || MAX_GAS_CALL
    })
  }

  public async extract(keys: string[]): Promise<(Uint8Array | null)[]> {
    return this.client
      .publicApi()
      .getDatastoreEntries(
        keys.map((key) => ({ address: this.address, key: strToBytes(key) }))
      )
      .then((res) => res.map((r) => r.candidate_value))
  }

  public async simulate(params: BaseCallData) {
    const callerAddress = this.client.wallet().getBaseAccount()?.address()
    if (!callerAddress) throw new Error('No caller address')

    return this.read({
      ...params,
      maxGas: MAX_GAS_CALL,
      callerAddress
    })
  }

  public async estimateGas(params: BaseCallData) {
    return this.simulate(params)
      .then((r) =>
        BigInt(
          Math.floor(Math.min(r.info.gas_cost * 1.1, Number(MAX_GAS_CALL)))
        )
      ) // 10% extra gas for safety
      .catch(() => MAX_GAS_CALL)
  }

  public async estimateCoins(params: BaseCallData) {
    return this.simulate({ ...params, coins: 0n })
      .then(() => 0n)
      .catch((err: Error) => {
        try {
          const errMsg = EventDecoder.decodeError(err.message)
          const coinErrorKeyword = 'Storage__NotEnoughCoinsSent:'
          const [needed] = errMsg.split(coinErrorKeyword)[1].split(',')
          return BigInt(needed)
        } catch {
          return 0n
        }
      })
  }
}

export const coins = MassaUnits.oneMassa / 100n // storage cost
