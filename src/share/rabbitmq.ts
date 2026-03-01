import * as amqp from 'amqplib';
import { logger } from './logger';

class RabbitMQService {
  private connection: amqp.ChannelModel | null = null;
  private senderChannel: amqp.Channel | null = null;
  private readonly QUEUE_NAME = 'raw_social_posts';
  private readonly QUEUE_TRACKER = 'tracker_updates';

  public async connect() {
    if (this.connection) return;
    
    try {
      this.connection = await amqp.connect('amqp://yuta2710:phucloi2710@localhost:5674/');
      this.senderChannel = await this.connection.createChannel();

      await this.senderChannel.assertQueue(this.QUEUE_NAME, {
        durable: true
      });
      await this.senderChannel.assertQueue(this.QUEUE_TRACKER, {
        durable: true
      });

      logger.info('🐰 Successfully connected to RabbitMQ!');

      this.connection.on('error', (err: any) => {
        logger.error('❌ RabbitMQ connection lost:', err);
        this.connection = null;
      });

    } catch (error) {
      logger.error('❌ RabbitMQ connection error:', error as any);
      console.log(error)
      throw error;
    }
  }

  public async publishScrapingData(data: any): Promise<boolean> {
    if (!this.senderChannel) {
      logger.warn('⚠️ RabbitMQ is not connected. Data transfer will be skipped.');
      return false;
    }

    try {
      const buffer = Buffer.from(JSON.stringify(data));
      
      const isSent = this.senderChannel.sendToQueue(this.QUEUE_NAME, buffer, {
        persistent: true
      });

      return isSent;
    } catch (error) {
      logger.error('❌ Error when sending data to RabbitMQ:', error as any);
      return false;
    }
  }

  public async publishTrackerUpdate(trackerData: any): Promise<boolean> {
    if (!this.senderChannel) return false;
    try {
      const buffer = Buffer.from(JSON.stringify(trackerData));
      return this.senderChannel.sendToQueue(this.QUEUE_TRACKER, buffer, { 
        persistent: true,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('❌ Lỗi khi gửi cập nhật Tracker:', error as any);
      return false;
    }
  }

  public async startLocalConsumerForTesting() {
    if (!this.connection) await this.connect();
    
    const consumerChannel = await this.connection!.createChannel();
    await consumerChannel.assertQueue(this.QUEUE_NAME, { durable: true });

    logger.info(`🎧 Currently listening to the test on Queue: ${this.QUEUE_NAME}...`);

    consumerChannel.consume(this.QUEUE_NAME, (msg) => {
      if (msg !== null) {
        const content = msg.content.toString();
        console.log('\n[RabbitMQ Local Test] 📩 Received Data:', JSON.parse(content));
        consumerChannel.ack(msg); 
      }
    });
  }
}

export const rabbitMQService = new RabbitMQService();
