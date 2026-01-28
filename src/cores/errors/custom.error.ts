import { ValidationType } from "../../types";
import { StatusCodes } from 'http-status-codes';

interface AppErrorArgs {
    name?: string;
    statusCode: StatusCodes;
    message: string;
    isOperational?: boolean;
    validationErrors?: ValidationType[];
}

export class AppError extends Error {
    public readonly name: string;
    public readonly statusCode: StatusCodes;
    public readonly isOperational: boolean = true;
    public readonly validationErrors?: ValidationType[];
    public readonly formattedStack?: string;

    constructor(args: AppErrorArgs) {
        const { message, name, statusCode, isOperational, validationErrors } = args;
        super(message);

        Object.setPrototypeOf(this, new.target.prototype);

        this.name = name ?? 'Aplication Error';
        this.statusCode = statusCode;
        if (isOperational !== undefined) this.isOperational = isOperational;

        this.validationErrors = validationErrors;
        this.formattedStack = this.stack ? this.formatStack(this.stack) : 'No stack trace available';
    }

    static badRequest(message: string, validationErrors?: ValidationType[]): AppError {
        return new AppError({ name: 'BadRequestError', message, statusCode: StatusCodes.BAD_REQUEST, validationErrors })
    }

    static unauthorized(message: string): AppError {
        return new AppError({ name: 'UnauthorizedError', message, statusCode: StatusCodes.UNAUTHORIZED });
    }

    static forbidden(message: string): AppError {
        return new AppError({ name: 'ForbiddenError', message, statusCode: StatusCodes.FORBIDDEN });
    }

    static notFound(message: string): AppError {
        return new AppError({ name: 'NotFoundError', message, statusCode: StatusCodes.NOT_FOUND });
    }

    static internalServer(message: string): AppError {
        return new AppError({ name: 'InternalServerError', message, statusCode: StatusCodes.INTERNAL_SERVER_ERROR });
    }

    private formatStack(stackTrace: string | undefined): string {
        if (!stackTrace) return "";

        const stackArray = stackTrace.split('\n');
        let filteredStack = stackArray.filter(line => {
            // Exclude Node.js internals and irrelevant stack lines
            return !line.includes('node_modules') && !line.includes('internal');
        });

        filteredStack = filteredStack.map(stack => stack.trim());

        // Return formatted, cleaned-up stack trace
        return filteredStack.slice(1, 5).join(" "); // Limit to 5 lines for brevity
    }
}
