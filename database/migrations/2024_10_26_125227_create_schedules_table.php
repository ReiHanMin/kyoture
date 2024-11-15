<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateSchedulesTable extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('schedules', function (Blueprint $table) {
            $table->id(); // Primary key
            $table->foreignId('event_id')->constrained()->onDelete('cascade'); // Foreign key to events
            $table->date('date'); // Date of the schedule
            $table->time('time_start')->nullable(); // Start time
            $table->time('time_end')->nullable(); // End time
            $table->text('special_notes')->nullable(); // Any special notes

            // Add the 'status' column
            $table->string('status')->default('upcoming');

            $table->timestamps(); // Adds created_at and updated_at columns
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('schedules');
    }
}
