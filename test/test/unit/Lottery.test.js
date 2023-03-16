const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery Unit Tests", function () {
          let lottery, vrfCoordinatorV2Mock, lotteryEntranceFee, deployer, interval
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              lottery = await ethers.getContract("Lottery", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              lotteryEntranceFee = await lottery.getEntranceFee()
              interval = await lottery.getInterval()
          })

          describe("constructor", function () {
              it("initializes the lottery correctly", async function () {
                  const lotteryState = await lottery.getLotteryState()
                  assert.equal(lotteryState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })

          describe("enterLottery", function () {
              it("reverts when you dont pay enough", async function () {
                  await expect(lottery.enterLottery()).to.be.revertedWith(
                      "Lottery__NotEnoughETHEntered"
                  )
              })

              it("record players when they enter", async function () {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  const playerfromContract = await lottery.getPlayers(0)
                  assert.equal(playerfromContract, deployer)
              })

              it("emit event on enter", async function () {
                  await expect(lottery.enterLottery({ value: lotteryEntranceFee })).to.emit(
                      lottery,
                      "LotteryEnter"
                  )
              })

              it("doesnt allow entrance when lottery is calculating", async function () {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  //Pretend to be a chainlink keep
                  await lottery.performUpkeep([])
              })

              describe("checkUpkeep", function () {
                  it("return false if people havent sent any ETH", async function () {
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                      await network.provider.send("evm_mine", [])
                      const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                      assert.equal(upkeepNeeded, false)
                  })

                  it("return false if lottery isn't open", async function () {
                      await lottery.enterLottery({ value: lotteryEntranceFee })
                      await network.provider.send("evm_mine", [])
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                      await lottery.performUpkeep([])
                      const lotteryState = await lottery.getLotteryState()
                      const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                      assert.equal(lotteryState.toString(), "1")
                      assert.equal(upkeepNeeded, false)
                  })

                  it("return false if enough time hasn't passed", async function () {
                      await lottery.enterLottery({ value: lotteryEntranceFee })
                      await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
                      await network.provider.request({ method: "evm_mine", params: [] })
                      const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                      assert(upkeepNeeded, false)
                  })

                  it("return true if enough time has passed, has players, eth, and is open", async function () {
                      await lottery.enterLottery({ value: lotteryEntranceFee })
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                      await network.provider.request({ method: "evm_mine", params: [] })
                      const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                      assert(upkeepNeeded)
                  })
              })

              describe("performUpkeep", function () {
                  it("it can only run when checkupkeep is true", async function () {
                      await lottery.enterLottery({ value: lotteryEntranceFee })
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                      await network.provider.send("evm_mine", [])
                      const txResponse = await lottery.performUpkeep([])
                      assert(txResponse)
                  })

                  it("reverts when checkupkeep is false", async function () {
                      await expect(lottery.performUpkeep([])).to.be.revertedWith(
                          "Lottery__UpkeepNotNeeded"
                      )
                  })

                  it("update the lottery state, emits event, and calls the vrf coordinator", async function () {
                      await lottery.enterLottery({ value: lotteryEntranceFee })
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                      await network.provider.send("evm_mine", [])
                      const txResponse = await lottery.performUpkeep([])
                      const txReceipt = await txResponse.wait(1)
                      const requestId = txReceipt.events[1].args.requestId
                      const lotteryState = await lottery.getLotteryState()
                      assert(requestId.toNumber() > 0)
                      assert(lotteryState.toString() == "1")
                  })
              })

              describe("fullfillRandomWords", function () {
                  beforeEach(async function () {
                      await lottery.enterLottery({ value: lotteryEntranceFee })
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                      await network.provider.send("evm_mine", [])
                  })

                  it("can only be called after performUpkeep", async function () {
                      await expect(
                          vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address)
                      ).to.be.revertedWith("nonexistent request")

                      await expect(
                          vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address)
                      ).to.be.revertedWith("nonexistent request")
                  })
                  it("picks a winner, resets the lottery, and sends the money", async function () {
                      const additionalEntrants = 3
                      const startingAccountIndex = 1 //deployer = 0
                      const accounts = await ethers.getSigners()
                      for (
                          let i = startingAccountIndex;
                          i < startingAccountIndex + additionalEntrants;
                          i++
                      ) {
                          const accountConnectedLottery = lottery.connect(accounts[i])
                          await accountConnectedLottery.enterLottery({ value: lotteryEntranceFee })
                      }
                      const startingTimeStamp = await lottery.getLatestTimestamp()

                      await new Promise(async (resolve, reject) => {
                          lottery.once("WinnerPicked", async () => {
                              console.log("Event found!!!")
                              try {
                                  const recentWinner = await lottery.getRecentWinner()
                                  //   console.log(`The winner is ${recentWinner}`)
                                  //   console.log(accounts[0].address)
                                  //   console.log(accounts[1].address)
                                  //   console.log(accounts[2].address)
                                  //   console.log(accounts[3].address)

                                  const lotteryState = await lottery.getLotteryState()
                                  const endingTimeStamp = await lottery.getLatestTimestamp()
                                  const numPlayers = await lottery.getNumberofPlayers()
                                  const winnerEndingBalance = await accounts[1].getBalance()

                                  assert.equal(numPlayers.toString(), "0")
                                  assert(lotteryState.toString() == "0")
                                  assert(endingTimeStamp > startingTimeStamp)

                                  assert(
                                      winnerEndingBalance.toString() ==
                                          winnerStartingBalance.add(
                                              lotteryEntranceFee
                                                  .mul(additionalEntrants)
                                                  .add(lotteryEntranceFee)
                                                  .toString()
                                          )
                                  )
                              } catch (err) {
                                  reject(err)
                              }
                              resolve()
                          })
                          const tx = await lottery.performUpkeep([])
                          const txReceipt = await tx.wait(1)
                          const winnerStartingBalance = await accounts[1].getBalance()
                          await vrfCoordinatorV2Mock.fulfillRandomWords(
                              txReceipt.events[1].args.requestId,
                              lottery.address
                          )
                      })
                  })
              })
          })
      })
