import * as amqp from "amqplib";
import type {
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
} from "amqplib";
import type { ConversionJobMessage } from "./job.js";

const CONTENT_TYPE = "application/json";

export class JobQueue {
  private constructor(
    private readonly connection: ChannelModel,
    private readonly channel: ConfirmChannel,
    readonly name: string,
  ) {}

  static async connect(url: string, name: string): Promise<JobQueue> {
    const connection = await amqp.connect(url);
    const channel = await connection.createConfirmChannel();
    const deadLetterExchange = `${name}.dead`;
    const deadLetterQueue = `${name}.dead`;

    await channel.assertExchange(deadLetterExchange, "direct", {
      durable: true,
    });
    await channel.assertQueue(deadLetterQueue, { durable: true });
    await channel.bindQueue(
      deadLetterQueue,
      deadLetterExchange,
      deadLetterQueue,
    );
    await channel.assertQueue(name, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": deadLetterExchange,
        "x-dead-letter-routing-key": deadLetterQueue,
      },
    });

    return new JobQueue(connection, channel, name);
  }

  async publish(message: ConversionJobMessage): Promise<void> {
    this.channel.sendToQueue(
      this.name,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        contentType: CONTENT_TYPE,
        messageId: message.jobId,
      },
    );
    await this.channel.waitForConfirms();
  }

  async consume(
    concurrency: number,
    handler: (
      message: ConversionJobMessage,
      rawMessage: ConsumeMessage,
    ) => Promise<void>,
  ): Promise<void> {
    await this.channel.prefetch(concurrency);
    await this.channel.consume(this.name, (rawMessage) => {
      if (!rawMessage) {
        return;
      }

      let message: ConversionJobMessage;

      try {
        message = JSON.parse(rawMessage.content.toString()) as ConversionJobMessage;
      } catch {
        this.channel.reject(rawMessage, false);
        return;
      }

      void handler(message, rawMessage).catch((error: unknown) => {
        console.error("Необработанная ошибка consumer:", error);
        this.channel.nack(rawMessage, false, true);
      });
    });
  }

  acknowledge(message: ConsumeMessage): void {
    this.channel.ack(message);
  }

  retry(message: ConsumeMessage): void {
    this.channel.nack(message, false, true);
  }

  reject(message: ConsumeMessage): void {
    this.channel.reject(message, false);
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}
